import { requestMfaResponse } from "../_shared/user-authorization.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function downloadAndUploadPdf(
  supabase: any,
  pdfUrl: string,
  storagePath: string
): Promise<string | null> {
  try {
    const pdfRes = await fetch(pdfUrl)
    if (!pdfRes.ok) return null
    const pdfBlob = await pdfRes.blob()
    const arrayBuffer = await pdfBlob.arrayBuffer()
    const uint8 = new Uint8Array(arrayBuffer)

    const { error } = await supabase.storage
      .from('invoices')
      .upload(storagePath, uint8, {
        contentType: 'application/pdf',
        upsert: true,
      })

    if (error) {
      console.error('Upload error:', error)
      return null
    }
    return storagePath
  } catch (e) {
    console.error('Download/upload error:', e)
    return null
  }
}

async function pollPdfUrl(baseUrl: string, docId: number, apiKey: string): Promise<string | null> {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/pdf/${docId}.json?api_key=${apiKey}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      })
      if (res.status === 200) {
        const data = await res.json()
        const url = data?.output?.pdfUrl
        if (url) return url
      }
      if (i < 2) await new Promise(r => setTimeout(r, 2000))
    } catch (e) {
      if (i < 2) await new Promise(r => setTimeout(r, 2000))
    }
  }
  return null
}

async function syncOrganization(supabase: any, organization_id: string, org: any) {
  const baseUrl = `https://${org.invoicexpress_account_name}.app.invoicexpress.com`
  const apiKey = org.invoicexpress_api_key

  // Fetch all credit notes from InvoiceXpress (paginated)
  let allCreditNotes: any[] = []
  let page = 1
  let hasMore = true

  while (hasMore) {
    const url = `${baseUrl}/credit_notes.json?api_key=${apiKey}&page=${page}&per_page=50`
    console.log(`[${organization_id}] Fetching credit notes page ${page}...`)

    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    })

    if (!res.ok) {
      const errorText = await res.text()
      console.error('InvoiceXpress error:', res.status, errorText)
      throw new Error(`Erro InvoiceXpress: ${res.status}`)
    }

    const data = await res.json()
    const notes = data?.credit_notes || []

    if (notes.length === 0) {
      hasMore = false
    } else {
      allCreditNotes = allCreditNotes.concat(notes)
      page++
      if (page > 20) hasMore = false
    }
  }

  console.log(`[${organization_id}] Found ${allCreditNotes.length} credit notes`)

  let synced = 0
  let notMatched = 0

  for (const cn of allCreditNotes) {
    const cnId = cn.id
    const cnRef = cn.sequence_number || cn.inverted_sequence_number || `NC-${cnId}`
    const cnTotal = parseFloat(cn.total || '0')
    const cnDate = cn.date || null
    const cnClientName = cn.client?.name || null
    const cnStatus = cn.status || null

    let relatedDocId: number | null = null
    let cnDetailRaw: any = cn

    try {
      const detailRes = await fetch(`${baseUrl}/credit_notes/${cnId}.json?api_key=${apiKey}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      })

      if (detailRes.ok) {
        const detailData = await detailRes.json()
        const cnDetail = detailData?.credit_note
        if (cnDetail) cnDetailRaw = cnDetail

        if (cnDetail?.related_documents && cnDetail.related_documents.length > 0) {
          relatedDocId = cnDetail.related_documents[0].id
          console.log(`[${organization_id}] CN ${cnId}: found related_document ID ${relatedDocId}`)
        } else {
          console.log(`[${organization_id}] CN ${cnId}: no related_documents found in API response`)
        }
        if (!relatedDocId && cnDetail?.observations) {
          const match = cnDetail.observations.match(/(?:fatura|invoice|FR|FT)\s*[#:]?\s*(\d+)/i)
          if (match) {
            relatedDocId = parseInt(match[1])
            console.log(`[${organization_id}] CN ${cnId}: extracted related doc ${relatedDocId} from observations`)
          }
        }
      }
    } catch (e) {
      console.warn(`Failed to get details for CN ${cnId}:`, e)
    }

    // Fallback: match by client_name + total in invoices table
    if (!relatedDocId && cnClientName && cnTotal > 0) {
      const { data: possibleInvoice } = await supabase
        .from('invoices')
        .select('invoicexpress_id')
        .eq('organization_id', organization_id)
        .eq('client_name', cnClientName)
        .eq('total', cnTotal)
        .neq('invoicexpress_id', cnId)
        .limit(1)
        .maybeSingle()

      if (possibleInvoice) {
        relatedDocId = possibleInvoice.invoicexpress_id
        console.log(`[${organization_id}] CN ${cnId}: matched related invoice ${relatedDocId} by client_name + total fallback`)
      }
    }

    // Also try to match by invoicexpress_id in invoices table
    if (relatedDocId) {
      const { data: matchedInvoice } = await supabase
        .from('invoices')
        .select('invoicexpress_id')
        .eq('organization_id', organization_id)
        .eq('invoicexpress_id', relatedDocId)
        .maybeSingle()
      
      if (matchedInvoice) {
        console.log(`[${organization_id}] CN ${cnId}: confirmed related invoice ${relatedDocId} exists in invoices table`)
      } else {
        console.log(`[${organization_id}] CN ${cnId}: related_invoice_id ${relatedDocId} NOT found in invoices table`)
      }
    }

    let matchedSaleId: string | null = null
    let matchedPaymentId: string | null = null

    if (relatedDocId) {
      const { data: sale } = await supabase
        .from('sales')
        .select('id')
        .eq('organization_id', organization_id)
        .eq('invoicexpress_id', relatedDocId)
        .maybeSingle()

      if (sale) {
        matchedSaleId = sale.id
        await supabase.from('sales').update({
          credit_note_id: cnId,
          credit_note_reference: cnRef,
        }).eq('id', sale.id)
      }

      if (!matchedSaleId) {
        const { data: payment } = await supabase
          .from('sale_payments')
          .select('id, sale_id')
          .eq('organization_id', organization_id)
          .eq('invoicexpress_id', relatedDocId)
          .maybeSingle()

        if (payment) {
          matchedPaymentId = payment.id
          matchedSaleId = payment.sale_id || null
          await supabase.from('sale_payments').update({
            credit_note_id: cnId,
            credit_note_reference: cnRef,
          }).eq('id', payment.id)
        }
      }

      if (!matchedSaleId && !matchedPaymentId) {
        try {
          const relDocRes = await fetch(`${baseUrl}/documents/${relatedDocId}.json?api_key=${apiKey}`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
          })
          if (relDocRes.ok) {
            const relDocData = await relDocRes.json()
            const relDoc = relDocData?.invoice_receipt || relDocData?.invoice || relDocData?.simplified_invoice || relDocData?.receipt
            const relSeq = relDoc?.sequence_number || relDoc?.inverted_sequence_number
            if (relSeq) {
              const { data: payments } = await supabase
                .from('sale_payments')
                .select('id, sale_id')
                .eq('organization_id', organization_id)
                .ilike('invoice_reference', `%${relSeq}%`)
                .limit(1)

              if (payments && payments.length > 0) {
                matchedPaymentId = payments[0].id
                matchedSaleId = payments[0].sale_id || null
                await supabase.from('sale_payments').update({
                  credit_note_id: cnId,
                  credit_note_reference: cnRef,
                }).eq('id', payments[0].id)
              }

              if (!matchedSaleId) {
                const { data: sales } = await supabase
                  .from('sales')
                  .select('id')
                  .eq('organization_id', organization_id)
                  .ilike('invoice_reference', `%${relSeq}%`)
                  .limit(1)

                if (sales && sales.length > 0) {
                  matchedSaleId = sales[0].id
                  await supabase.from('sales').update({
                    credit_note_id: cnId,
                    credit_note_reference: cnRef,
                  }).eq('id', sales[0].id)
                }
              }
            }
          }
        } catch (e) {
          console.warn('Failed to resolve related doc sequence:', e)
        }
      }
    }

    if (!matchedSaleId && !matchedPaymentId && cnClientName) {
      const { data: salesByClient } = await supabase
        .from('sales')
        .select('id, crm_clients:client_id(name), leads:lead_id(name)')
        .eq('organization_id', organization_id)
        .is('credit_note_id', null)
        .limit(50)

      if (salesByClient) {
        for (const s of salesByClient) {
          const clientName = (s as any).crm_clients?.name || (s as any).leads?.name
          if (clientName && clientName.toLowerCase().includes(cnClientName.toLowerCase())) {
            matchedSaleId = s.id
            await supabase.from('sales').update({
              credit_note_id: cnId,
              credit_note_reference: cnRef,
            }).eq('id', s.id)
            break
          }
        }
      }
    }

    let pdfPath: string | null = null
    try {
      const pdfTempUrl = await pollPdfUrl(baseUrl, cnId, apiKey)
      if (pdfTempUrl) {
        const fileName = `${organization_id}/credit_note_${cnId}.pdf`
        pdfPath = await downloadAndUploadPdf(supabase, pdfTempUrl, fileName)
      }
    } catch (e) {
      console.warn(`Failed to download PDF for CN ${cnId}:`, e)
    }

    const { error: upsertError } = await supabase
      .from('credit_notes')
      .upsert({
        organization_id,
        invoicexpress_id: cnId,
        reference: cnRef,
        status: cnStatus,
        client_name: cnClientName,
        total: cnTotal,
        date: cnDate,
        related_invoice_id: relatedDocId,
        sale_id: matchedSaleId,
        payment_id: matchedPaymentId,
        pdf_path: pdfPath,
        raw_data: cnDetailRaw,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'organization_id,invoicexpress_id',
      })

    if (upsertError) {
      console.error(`Upsert error for CN ${cnId}:`, upsertError)
    }

    if (matchedSaleId || matchedPaymentId) {
      synced++
    } else {
      notMatched++
    }
  }

  return { total: allCreditNotes.length, synced, not_matched: notMatched }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const body = await req.json()
    const { sync_all, organization_id } = body

    // Mode 1: sync_all - internal cron call, iterate all orgs with IX credentials
    if (sync_all) {
      // Guard the cross-tenant cron path: when CRON_SECRET is set, require it so a
      // public caller can't force a full sync of every org (InvoiceXpress cost/abuse).
      const cronSecret = Deno.env.get('CRON_SECRET')
      if (cronSecret) {
        const provided = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('key')
        if (provided !== cronSecret) {
          return new Response(JSON.stringify({ error: 'Não autorizado' }), {
            status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
      }
      console.log('Running sync_all mode for all organizations...')
      const { data: orgs, error: orgsError } = await supabase
        .from('organizations')
        .select('id, invoicexpress_account_name, invoicexpress_api_key, billing_provider')
        .or('billing_provider.eq.invoicexpress,billing_provider.is.null')
        .not('invoicexpress_account_name', 'is', null)
        .not('invoicexpress_api_key', 'is', null)

      if (orgsError || !orgs?.length) {
        console.log('No organizations with IX credentials found')
        return new Response(JSON.stringify({ message: 'No organizations to sync' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      let totalResults = { total: 0, synced: 0, not_matched: 0, orgs_processed: 0 }
      for (const org of orgs) {
        try {
          const result = await syncOrganization(supabase, org.id, org)
          totalResults.total += result.total
          totalResults.synced += result.synced
          totalResults.not_matched += result.not_matched
          totalResults.orgs_processed++
        } catch (e) {
          console.error(`Error syncing org ${org.id}:`, e)
        }
      }

      console.log('sync_all complete:', totalResults)
      return new Response(JSON.stringify(totalResults), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Mode 2: single org sync (user-triggered)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const mfaResponse = await requestMfaResponse(req, user.id, corsHeaders);
    if (mfaResponse) return mfaResponse;

    if (!organization_id) {
      return new Response(JSON.stringify({ error: 'organization_id é obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: membership } = await supabase
      .from('organization_members')
      .select('id')
      .eq('user_id', user.id)
      .eq('organization_id', organization_id)
      .eq('is_active', true)
      .maybeSingle()

    if (!membership) {
      return new Response(JSON.stringify({ error: 'Sem acesso a esta organização' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: org } = await supabase
      .from('organizations')
      .select('invoicexpress_account_name, invoicexpress_api_key, billing_provider')
      .eq('id', organization_id)
      .single()

    if (org?.billing_provider && org.billing_provider !== 'invoicexpress') {
      return new Response(JSON.stringify({ total: 0, synced: 0, not_matched: 0 }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!org?.invoicexpress_account_name || !org?.invoicexpress_api_key) {
      return new Response(JSON.stringify({ error: 'Credenciais InvoiceXpress não configuradas' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const result = await syncOrganization(supabase, organization_id, org)

    return new Response(JSON.stringify(result), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Unexpected error:', err)
    return new Response(JSON.stringify({ error: 'Erro interno do servidor' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
