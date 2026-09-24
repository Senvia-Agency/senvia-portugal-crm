export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activation_objectives: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          month: string
          organization_id: string
          period_type: string
          proposal_type: string
          target_quantity: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          month: string
          organization_id: string
          period_type: string
          proposal_type: string
          target_quantity?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          month?: string
          organization_id?: string
          period_type?: string
          proposal_type?: string
          target_quantity?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activation_objectives_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activation_objectives_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "activation_objectives_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      app_announcements: {
        Row: {
          content: string
          created_at: string
          expires_at: string | null
          id: string
          image_url: string | null
          is_active: boolean
          published_at: string
          title: string
          version: string | null
        }
        Insert: {
          content: string
          created_at?: string
          expires_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          published_at?: string
          title: string
          version?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          published_at?: string
          title?: string
          version?: string | null
        }
        Relationships: []
      }
      automation_flows: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          entry_node_id: string | null
          graph: Json
          id: string
          last_enrolled_at: string | null
          max_steps_per_run: number
          name: string
          organization_id: string
          quiet_hours: Json | null
          reentry_policy: string
          status: string
          trigger_config: Json
          trigger_type: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          entry_node_id?: string | null
          graph?: Json
          id?: string
          last_enrolled_at?: string | null
          max_steps_per_run?: number
          name: string
          organization_id: string
          quiet_hours?: Json | null
          reentry_policy?: string
          status?: string
          trigger_config?: Json
          trigger_type: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          entry_node_id?: string | null
          graph?: Json
          id?: string
          last_enrolled_at?: string | null
          max_steps_per_run?: number
          name?: string
          organization_id?: string
          quiet_hours?: Json | null
          reentry_policy?: string
          status?: string
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "automation_flows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_flows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "automation_flows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      automation_queue: {
        Row: {
          automation_id: string
          created_at: string
          id: string
          organization_id: string
          recipient_email: string
          recipient_name: string | null
          scheduled_for: string
          status: string
          template_id: string
          variables: Json | null
        }
        Insert: {
          automation_id: string
          created_at?: string
          id?: string
          organization_id: string
          recipient_email: string
          recipient_name?: string | null
          scheduled_for: string
          status?: string
          template_id: string
          variables?: Json | null
        }
        Update: {
          automation_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          recipient_email?: string
          recipient_name?: string | null
          scheduled_for?: string
          status?: string
          template_id?: string
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_queue_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "email_automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "automation_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "automation_queue_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_run_steps: {
        Row: {
          created_at: string
          detail: Json
          id: number
          node_id: string
          node_type: string
          organization_id: string
          run_id: string
          status: string
        }
        Insert: {
          created_at?: string
          detail?: Json
          id?: number
          node_id: string
          node_type: string
          organization_id: string
          run_id: string
          status?: string
        }
        Update: {
          created_at?: string
          detail?: Json
          id?: number
          node_id?: string
          node_type?: string
          organization_id?: string
          run_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_run_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_run_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "automation_run_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "automation_run_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "automation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_runs: {
        Row: {
          completed_at: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          contact_phone_key: string | null
          context: Json
          current_node_id: string | null
          flow_id: string
          flow_version: number
          id: string
          last_error: string | null
          organization_id: string
          started_at: string
          status: string
          steps_taken: number
          subject_id: string | null
          subject_type: string
          updated_at: string
          wake_at: string | null
        }
        Insert: {
          completed_at?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_phone_key?: string | null
          context?: Json
          current_node_id?: string | null
          flow_id: string
          flow_version?: number
          id?: string
          last_error?: string | null
          organization_id: string
          started_at?: string
          status?: string
          steps_taken?: number
          subject_id?: string | null
          subject_type?: string
          updated_at?: string
          wake_at?: string | null
        }
        Update: {
          completed_at?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_phone_key?: string | null
          context?: Json
          current_node_id?: string | null
          flow_id?: string
          flow_version?: number
          id?: string
          last_error?: string | null
          organization_id?: string
          started_at?: string
          status?: string
          steps_taken?: number
          subject_id?: string | null
          subject_type?: string
          updated_at?: string
          wake_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "automation_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "automation_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      bank_account_transactions: {
        Row: {
          amount: number
          bank_account_id: string
          created_at: string
          description: string | null
          id: string
          organization_id: string
          reference_id: string | null
          reference_type: string | null
          running_balance: number
          transaction_date: string
          type: string
          updated_at: string
        }
        Insert: {
          amount: number
          bank_account_id: string
          created_at?: string
          description?: string | null
          id?: string
          organization_id: string
          reference_id?: string | null
          reference_type?: string | null
          running_balance?: number
          transaction_date?: string
          type: string
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_account_id?: string
          created_at?: string
          description?: string | null
          id?: string
          organization_id?: string
          reference_id?: string | null
          reference_type?: string | null
          running_balance?: number
          transaction_date?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_account_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_account_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_account_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "bank_account_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          bank_name: string | null
          created_at: string
          holder_name: string | null
          iban: string | null
          id: string
          initial_balance: number
          is_active: boolean
          is_default: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          bank_name?: string | null
          created_at?: string
          holder_name?: string | null
          iban?: string | null
          id?: string
          initial_balance?: number
          is_active?: boolean
          is_default?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          bank_name?: string | null
          created_at?: string
          holder_name?: string | null
          iban?: string | null
          id?: string
          initial_balance?: number
          is_active?: boolean
          is_default?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "bank_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          all_day: boolean | null
          client_id: string | null
          created_at: string | null
          description: string | null
          end_time: string | null
          event_type: string
          id: string
          lead_id: string | null
          meeting_link: string | null
          organization_id: string
          reminder_minutes: number | null
          reminder_sent: boolean | null
          start_time: string
          status: string | null
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          all_day?: boolean | null
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          end_time?: string | null
          event_type?: string
          id?: string
          lead_id?: string | null
          meeting_link?: string | null
          organization_id: string
          reminder_minutes?: number | null
          reminder_sent?: boolean | null
          start_time: string
          status?: string | null
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          all_day?: boolean | null
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          end_time?: string | null
          event_type?: string
          id?: string
          lead_id?: string | null
          meeting_link?: string | null
          organization_id?: string
          reminder_minutes?: number | null
          reminder_sent?: boolean | null
          start_time?: string
          status?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      chatwoot_processed_messages: {
        Row: {
          account_id: number
          created_at: string
          message_id: number
        }
        Insert: {
          account_id: number
          created_at?: string
          message_id: number
        }
        Update: {
          account_id?: number
          created_at?: string
          message_id?: number
        }
        Relationships: []
      }
      client_communications: {
        Row: {
          client_id: string
          content: string | null
          created_at: string | null
          created_by: string | null
          direction: string | null
          duration_seconds: number | null
          id: string
          occurred_at: string
          organization_id: string
          subject: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          client_id: string
          content?: string | null
          created_at?: string | null
          created_by?: string | null
          direction?: string | null
          duration_seconds?: number | null
          id?: string
          occurred_at?: string
          organization_id: string
          subject?: string | null
          type: string
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          content?: string | null
          created_at?: string | null
          created_by?: string | null
          direction?: string | null
          duration_seconds?: number | null
          id?: string
          occurred_at?: string
          organization_id?: string
          subject?: string | null
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      client_list_members: {
        Row: {
          added_at: string
          client_id: string
          id: string
          list_id: string
        }
        Insert: {
          added_at?: string
          client_id: string
          id?: string
          list_id: string
        }
        Update: {
          added_at?: string
          client_id?: string
          id?: string
          list_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_list_members_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_list_members_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "client_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      client_lists: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          filter_criteria: Json | null
          id: string
          is_dynamic: boolean | null
          is_system: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          filter_criteria?: Json | null
          id?: string
          is_dynamic?: boolean | null
          is_system?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          filter_criteria?: Json | null
          id?: string
          is_dynamic?: boolean | null
          is_system?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_lists_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_lists_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "client_lists_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      commission_chargeback_imports: {
        Row: {
          chargeback_count: number
          cpe_column_name: string
          created_at: string
          file_name: string
          id: string
          imported_by: string
          matched_rows: number
          organization_id: string
          reference_month: string | null
          total_chargeback_amount: number
          total_rows: number
          unmatched_rows: number
        }
        Insert: {
          chargeback_count?: number
          cpe_column_name: string
          created_at?: string
          file_name: string
          id?: string
          imported_by: string
          matched_rows?: number
          organization_id: string
          reference_month?: string | null
          total_chargeback_amount?: number
          total_rows?: number
          unmatched_rows?: number
        }
        Update: {
          chargeback_count?: number
          cpe_column_name?: string
          created_at?: string
          file_name?: string
          id?: string
          imported_by?: string
          matched_rows?: number
          organization_id?: string
          reference_month?: string | null
          total_chargeback_amount?: number
          total_rows?: number
          unmatched_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "commission_chargeback_imports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_chargeback_imports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "commission_chargeback_imports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      commission_chargeback_items: {
        Row: {
          chargeback_amount: number
          cpe: string
          created_at: string
          id: string
          import_id: string
          matched: boolean
          matched_proposal_cpe_id: string | null
          matched_proposal_id: string | null
          matched_sale_id: string | null
          matched_user_id: string | null
          normalized_cpe: string | null
          organization_id: string
          raw_row: Json
          row_index: number
          unmatched_reason: string | null
        }
        Insert: {
          chargeback_amount?: number
          cpe: string
          created_at?: string
          id?: string
          import_id: string
          matched?: boolean
          matched_proposal_cpe_id?: string | null
          matched_proposal_id?: string | null
          matched_sale_id?: string | null
          matched_user_id?: string | null
          normalized_cpe?: string | null
          organization_id: string
          raw_row?: Json
          row_index: number
          unmatched_reason?: string | null
        }
        Update: {
          chargeback_amount?: number
          cpe?: string
          created_at?: string
          id?: string
          import_id?: string
          matched?: boolean
          matched_proposal_cpe_id?: string | null
          matched_proposal_id?: string | null
          matched_sale_id?: string | null
          matched_user_id?: string | null
          normalized_cpe?: string | null
          organization_id?: string
          raw_row?: Json
          row_index?: number
          unmatched_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commission_chargeback_items_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "commission_chargeback_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_chargeback_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_chargeback_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "commission_chargeback_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      commission_closing_items: {
        Row: {
          closing_id: string
          created_at: string
          id: string
          items_detail: Json
          organization_id: string
          total_chargeback: number
          total_commission: number
          total_consumo_mwh: number
          user_id: string
          volume_tier: string
        }
        Insert: {
          closing_id: string
          created_at?: string
          id?: string
          items_detail?: Json
          organization_id: string
          total_chargeback?: number
          total_commission?: number
          total_consumo_mwh?: number
          user_id: string
          volume_tier: string
        }
        Update: {
          closing_id?: string
          created_at?: string
          id?: string
          items_detail?: Json
          organization_id?: string
          total_chargeback?: number
          total_commission?: number
          total_consumo_mwh?: number
          user_id?: string
          volume_tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_closing_items_closing_id_fkey"
            columns: ["closing_id"]
            isOneToOne: false
            referencedRelation: "commission_closings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_closing_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_closing_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "commission_closing_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      commission_closings: {
        Row: {
          closed_at: string
          closed_by: string
          created_at: string
          id: string
          month: string
          notes: string | null
          organization_id: string
          total_chargeback: number
          total_commission: number
        }
        Insert: {
          closed_at?: string
          closed_by: string
          created_at?: string
          id?: string
          month: string
          notes?: string | null
          organization_id: string
          total_chargeback?: number
          total_commission?: number
        }
        Update: {
          closed_at?: string
          closed_by?: string
          created_at?: string
          id?: string
          month?: string
          notes?: string | null
          organization_id?: string
          total_chargeback?: number
          total_commission?: number
        }
        Relationships: [
          {
            foreignKeyName: "commission_closings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_closings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "commission_closings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      commitment_lines: {
        Row: {
          comissao: number
          commitment_id: string
          created_at: string
          energia_mwh: number
          id: string
          nif: string
          notes: string | null
          proposal_id: string | null
          solar_kwp: number
        }
        Insert: {
          comissao?: number
          commitment_id: string
          created_at?: string
          energia_mwh?: number
          id?: string
          nif: string
          notes?: string | null
          proposal_id?: string | null
          solar_kwp?: number
        }
        Update: {
          comissao?: number
          commitment_id?: string
          created_at?: string
          energia_mwh?: number
          id?: string
          nif?: string
          notes?: string | null
          proposal_id?: string | null
          solar_kwp?: number
        }
        Relationships: [
          {
            foreignKeyName: "commitment_lines_commitment_id_fkey"
            columns: ["commitment_id"]
            isOneToOne: false
            referencedRelation: "monthly_commitments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commitment_lines_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_notes: {
        Row: {
          author_name: string | null
          content: string
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          phone: string
          phone_key: string
          source: string
          updated_at: string
        }
        Insert: {
          author_name?: string | null
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          phone: string
          phone_key: string
          source?: string
          updated_at?: string
        }
        Update: {
          author_name?: string | null
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          phone?: string
          phone_key?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "contact_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      cpes: {
        Row: {
          alert_30d_sent: boolean | null
          alert_7d_sent: boolean | null
          client_id: string
          comercializador: string
          consumo_anual: number | null
          created_at: string
          equipment_type: string
          fidelizacao_end: string | null
          fidelizacao_start: string | null
          id: string
          nivel_tensao: string | null
          notes: string | null
          organization_id: string
          renewal_status: string | null
          serial_number: string | null
          status: string
          updated_at: string
        }
        Insert: {
          alert_30d_sent?: boolean | null
          alert_7d_sent?: boolean | null
          client_id: string
          comercializador: string
          consumo_anual?: number | null
          created_at?: string
          equipment_type: string
          fidelizacao_end?: string | null
          fidelizacao_start?: string | null
          id?: string
          nivel_tensao?: string | null
          notes?: string | null
          organization_id: string
          renewal_status?: string | null
          serial_number?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          alert_30d_sent?: boolean | null
          alert_7d_sent?: boolean | null
          client_id?: string
          comercializador?: string
          consumo_anual?: number | null
          created_at?: string
          equipment_type?: string
          fidelizacao_end?: string | null
          fidelizacao_start?: string | null
          id?: string
          nivel_tensao?: string | null
          notes?: string | null
          organization_id?: string
          renewal_status?: string | null
          serial_number?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cpes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cpes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cpes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "cpes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      credit_notes: {
        Row: {
          client_name: string | null
          created_at: string | null
          date: string | null
          id: string
          invoicexpress_id: number
          organization_id: string
          payment_id: string | null
          pdf_path: string | null
          raw_data: Json | null
          reference: string | null
          related_invoice_id: number | null
          sale_id: string | null
          status: string | null
          total: number | null
          updated_at: string | null
        }
        Insert: {
          client_name?: string | null
          created_at?: string | null
          date?: string | null
          id?: string
          invoicexpress_id: number
          organization_id: string
          payment_id?: string | null
          pdf_path?: string | null
          raw_data?: Json | null
          reference?: string | null
          related_invoice_id?: number | null
          sale_id?: string | null
          status?: string | null
          total?: number | null
          updated_at?: string | null
        }
        Update: {
          client_name?: string | null
          created_at?: string | null
          date?: string | null
          id?: string
          invoicexpress_id?: number
          organization_id?: string
          payment_id?: string | null
          pdf_path?: string | null
          raw_data?: Json | null
          reference?: string | null
          related_invoice_id?: number | null
          sale_id?: string | null
          status?: string | null
          total?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "credit_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "credit_notes_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "sale_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_clients: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          company_address_line1: string | null
          company_address_line2: string | null
          company_city: string | null
          company_postal_code: string | null
          company_country: string | null
          assigned_to: string | null
          billing_target: string
          city: string | null
          code: string | null
          company: string | null
          company_nif: string | null
          conselho: string | null
          country: string | null
          created_at: string | null
          distrito: string | null
          email: string | null
          grupo_economico: string | null
          id: string
          lead_id: string | null
          name: string
          nif: string | null
          notes: string | null
          organization_id: string
          phone: string | null
          postal_code: string | null
          source: string | null
          status: string | null
          total_comissao: number | null
          total_kwp: number | null
          total_mwh: number | null
          total_proposals: number | null
          total_sales: number | null
          total_value: number | null
          updated_at: string | null
          whatsapp: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          company_address_line1?: string | null
          company_address_line2?: string | null
          company_city?: string | null
          company_postal_code?: string | null
          company_country?: string | null
          assigned_to?: string | null
          billing_target?: string
          city?: string | null
          code?: string | null
          company?: string | null
          company_nif?: string | null
          conselho?: string | null
          country?: string | null
          created_at?: string | null
          distrito?: string | null
          email?: string | null
          grupo_economico?: string | null
          id?: string
          lead_id?: string | null
          name: string
          nif?: string | null
          notes?: string | null
          organization_id: string
          phone?: string | null
          postal_code?: string | null
          source?: string | null
          status?: string | null
          total_comissao?: number | null
          total_kwp?: number | null
          total_mwh?: number | null
          total_proposals?: number | null
          total_sales?: number | null
          total_value?: number | null
          updated_at?: string | null
          whatsapp?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          company_address_line1?: string | null
          company_address_line2?: string | null
          company_city?: string | null
          company_postal_code?: string | null
          company_country?: string | null
          assigned_to?: string | null
          billing_target?: string
          city?: string | null
          code?: string | null
          company?: string | null
          company_nif?: string | null
          conselho?: string | null
          country?: string | null
          created_at?: string | null
          distrito?: string | null
          email?: string | null
          grupo_economico?: string | null
          id?: string
          lead_id?: string | null
          name?: string
          nif?: string | null
          notes?: string | null
          organization_id?: string
          phone?: string | null
          postal_code?: string | null
          source?: string | null
          status?: string | null
          total_comissao?: number | null
          total_kwp?: number | null
          total_mwh?: number | null
          total_proposals?: number | null
          total_sales?: number | null
          total_value?: number | null
          updated_at?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_clients_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "crm_clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      customer_addresses: {
        Row: {
          address_line1: string
          address_line2: string | null
          city: string
          country: string | null
          created_at: string | null
          customer_id: string
          id: string
          is_default: boolean | null
          name: string
          phone: string | null
          postal_code: string
          type: string | null
        }
        Insert: {
          address_line1: string
          address_line2?: string | null
          city: string
          country?: string | null
          created_at?: string | null
          customer_id: string
          id?: string
          is_default?: boolean | null
          name: string
          phone?: string | null
          postal_code: string
          type?: string | null
        }
        Update: {
          address_line1?: string
          address_line2?: string | null
          city?: string
          country?: string | null
          created_at?: string | null
          customer_id?: string
          id?: string
          is_default?: boolean | null
          name?: string
          phone?: string | null
          postal_code?: string
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          accepts_marketing: boolean | null
          created_at: string | null
          email: string
          id: string
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          total_orders: number | null
          total_spent: number | null
          updated_at: string | null
        }
        Insert: {
          accepts_marketing?: boolean | null
          created_at?: string | null
          email: string
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          total_orders?: number | null
          total_spent?: number | null
          updated_at?: string | null
        }
        Update: {
          accepts_marketing?: boolean | null
          created_at?: string | null
          email?: string
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          total_orders?: number | null
          total_spent?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      dashboard_widgets: {
        Row: {
          config: Json | null
          created_at: string | null
          id: string
          is_visible: boolean
          organization_id: string
          position: number
          user_id: string
          widget_type: string
        }
        Insert: {
          config?: Json | null
          created_at?: string | null
          id?: string
          is_visible?: boolean
          organization_id: string
          position?: number
          user_id: string
          widget_type: string
        }
        Update: {
          config?: Json | null
          created_at?: string | null
          id?: string
          is_visible?: boolean
          organization_id?: string
          position?: number
          user_id?: string
          widget_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_widgets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_widgets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "dashboard_widgets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      discount_codes: {
        Row: {
          code: string
          created_at: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          max_uses: number | null
          min_purchase: number | null
          organization_id: string
          starts_at: string | null
          type: string
          uses_count: number | null
          value: number
        }
        Insert: {
          code: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          max_uses?: number | null
          min_purchase?: number | null
          organization_id: string
          starts_at?: string | null
          type: string
          uses_count?: number | null
          value: number
        }
        Update: {
          code?: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          max_uses?: number | null
          min_purchase?: number | null
          organization_id?: string
          starts_at?: string | null
          type?: string
          uses_count?: number | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "discount_codes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_codes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "discount_codes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      ecommerce_products: {
        Row: {
          category_id: string | null
          compare_at_price: number | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_digital: boolean | null
          low_stock_threshold: number | null
          name: string
          organization_id: string
          price: number | null
          requires_shipping: boolean | null
          short_description: string | null
          sku: string | null
          slug: string | null
          stock_quantity: number | null
          tags: string[] | null
          track_inventory: boolean | null
          updated_at: string | null
          weight_grams: number | null
        }
        Insert: {
          category_id?: string | null
          compare_at_price?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_digital?: boolean | null
          low_stock_threshold?: number | null
          name: string
          organization_id: string
          price?: number | null
          requires_shipping?: boolean | null
          short_description?: string | null
          sku?: string | null
          slug?: string | null
          stock_quantity?: number | null
          tags?: string[] | null
          track_inventory?: boolean | null
          updated_at?: string | null
          weight_grams?: number | null
        }
        Update: {
          category_id?: string | null
          compare_at_price?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_digital?: boolean | null
          low_stock_threshold?: number | null
          name?: string
          organization_id?: string
          price?: number | null
          requires_shipping?: boolean | null
          short_description?: string | null
          sku?: string | null
          slug?: string | null
          stock_quantity?: number | null
          tags?: string[] | null
          track_inventory?: boolean | null
          updated_at?: string | null
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ecommerce_products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecommerce_products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecommerce_products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "ecommerce_products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      email_attachments: {
        Row: {
          content_id: string | null
          content_type: string | null
          created_at: string
          data_b64: string | null
          filename: string | null
          id: string
          inline: boolean
          message_id: string
          organization_id: string
          part_id: string | null
          size: number | null
          storage_path: string | null
        }
        Insert: {
          content_id?: string | null
          content_type?: string | null
          created_at?: string
          data_b64?: string | null
          filename?: string | null
          id?: string
          inline?: boolean
          message_id: string
          organization_id: string
          part_id?: string | null
          size?: number | null
          storage_path?: string | null
        }
        Update: {
          content_id?: string | null
          content_type?: string | null
          created_at?: string
          data_b64?: string | null
          filename?: string | null
          id?: string
          inline?: boolean
          message_id?: string
          organization_id?: string
          part_id?: string | null
          size?: number | null
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "email_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "email_attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      email_automations: {
        Row: {
          created_at: string
          created_by: string | null
          delay_minutes: number
          id: string
          is_active: boolean
          last_triggered_at: string | null
          list_id: string | null
          name: string
          organization_id: string
          recipient_type: string
          template_id: string
          total_triggered: number
          trigger_config: Json | null
          trigger_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delay_minutes?: number
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          list_id?: string | null
          name: string
          organization_id: string
          recipient_type?: string
          template_id: string
          total_triggered?: number
          trigger_config?: Json | null
          trigger_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delay_minutes?: number
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          list_id?: string | null
          name?: string
          organization_id?: string
          recipient_type?: string
          template_id?: string
          total_triggered?: number
          trigger_config?: Json | null
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_automations_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "client_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_automations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_automations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "email_automations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "email_automations_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaigns: {
        Row: {
          created_at: string
          created_by: string | null
          failed_count: number
          html_content: string | null
          id: string
          name: string
          organization_id: string
          scheduled_at: string | null
          sent_at: string | null
          sent_count: number
          settings: Json | null
          settings_data: Json | null
          status: string
          subject: string | null
          template_id: string | null
          total_recipients: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          failed_count?: number
          html_content?: string | null
          id?: string
          name: string
          organization_id: string
          scheduled_at?: string | null
          sent_at?: string | null
          sent_count?: number
          settings?: Json | null
          settings_data?: Json | null
          status?: string
          subject?: string | null
          template_id?: string | null
          total_recipients?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          failed_count?: number
          html_content?: string | null
          id?: string
          name?: string
          organization_id?: string
          scheduled_at?: string | null
          sent_at?: string | null
          sent_count?: number
          settings?: Json | null
          settings_data?: Json | null
          status?: string
          subject?: string | null
          template_id?: string | null
          total_recipients?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "email_campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "email_campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_commands: {
        Row: {
          channel_id: string
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          organization_id: string
          payload: Json
          processed_at: string | null
          status: string
          type: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          organization_id: string
          payload?: Json
          processed_at?: string | null
          status?: string
          type: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          organization_id?: string
          payload?: Json
          processed_at?: string | null
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_commands_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "messaging_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_commands_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_commands_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "email_commands_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      email_drafts: {
        Row: {
          attachments: Json
          author_id: string | null
          bcc_addresses: Json
          body_html: string | null
          cc_addresses: Json
          channel_id: string
          created_at: string
          id: string
          imap_uid: number | null
          in_reply_to: string | null
          organization_id: string
          reply_message_id: string | null
          subject: string | null
          to_addresses: Json
          updated_at: string
        }
        Insert: {
          attachments?: Json
          author_id?: string | null
          bcc_addresses?: Json
          body_html?: string | null
          cc_addresses?: Json
          channel_id: string
          created_at?: string
          id?: string
          imap_uid?: number | null
          in_reply_to?: string | null
          organization_id: string
          reply_message_id?: string | null
          subject?: string | null
          to_addresses?: Json
          updated_at?: string
        }
        Update: {
          attachments?: Json
          author_id?: string | null
          bcc_addresses?: Json
          body_html?: string | null
          cc_addresses?: Json
          channel_id?: string
          created_at?: string
          id?: string
          imap_uid?: number | null
          in_reply_to?: string | null
          organization_id?: string
          reply_message_id?: string | null
          subject?: string | null
          to_addresses?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_drafts_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "messaging_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "email_drafts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "email_drafts_reply_message_id_fkey"
            columns: ["reply_message_id"]
            isOneToOne: false
            referencedRelation: "email_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      email_folders: {
        Row: {
          channel_id: string
          created_at: string
          id: string
          last_synced_at: string | null
          name: string
          organization_id: string
          parent_path: string | null
          path: string
          role: string
          sort: number
          special_use: string | null
          subscribed: boolean
          total_count: number
          uidnext: number | null
          uidvalidity: number | null
          unread_count: number
          updated_at: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          id?: string
          last_synced_at?: string | null
          name: string
          organization_id: string
          parent_path?: string | null
          path: string
          role?: string
          sort?: number
          special_use?: string | null
          subscribed?: boolean
          total_count?: number
          uidnext?: number | null
          uidvalidity?: number | null
          unread_count?: number
          updated_at?: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          id?: string
          last_synced_at?: string | null
          name?: string
          organization_id?: string
          parent_path?: string | null
          path?: string
          role?: string
          sort?: number
          special_use?: string | null
          subscribed?: boolean
          total_count?: number
          uidnext?: number | null
          uidvalidity?: number | null
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_folders_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "messaging_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_folders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_folders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "email_folders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      email_messages: {
        Row: {
          answered: boolean
          bcc_addresses: Json
          body_fetched: boolean
          cc_addresses: Json
          channel_id: string
          created_at: string
          date: string | null
          draft: boolean
          email_references: string[] | null
          flagged: boolean
          folder_id: string
          from_address: string | null
          from_name: string | null
          has_attachments: boolean
          html_body: string | null
          id: string
          in_reply_to: string | null
          message_id: string | null
          organization_id: string
          reply_to: Json | null
          seen: boolean
          size: number | null
          snippet: string | null
          subject: string | null
          text_body: string | null
          thread_id: string | null
          to_addresses: Json
          uid: number
          updated_at: string
        }
        Insert: {
          answered?: boolean
          bcc_addresses?: Json
          body_fetched?: boolean
          cc_addresses?: Json
          channel_id: string
          created_at?: string
          date?: string | null
          draft?: boolean
          email_references?: string[] | null
          flagged?: boolean
          folder_id: string
          from_address?: string | null
          from_name?: string | null
          has_attachments?: boolean
          html_body?: string | null
          id?: string
          in_reply_to?: string | null
          message_id?: string | null
          organization_id: string
          reply_to?: Json | null
          seen?: boolean
          size?: number | null
          snippet?: string | null
          subject?: string | null
          text_body?: string | null
          thread_id?: string | null
          to_addresses?: Json
          uid: number
          updated_at?: string
        }
        Update: {
          answered?: boolean
          bcc_addresses?: Json
          body_fetched?: boolean
          cc_addresses?: Json
          channel_id?: string
          created_at?: string
          date?: string | null
          draft?: boolean
          email_references?: string[] | null
          flagged?: boolean
          folder_id?: string
          from_address?: string | null
          from_name?: string | null
          has_attachments?: boolean
          html_body?: string | null
          id?: string
          in_reply_to?: string | null
          message_id?: string | null
          organization_id?: string
          reply_to?: Json | null
          seen?: boolean
          size?: number | null
          snippet?: string | null
          subject?: string | null
          text_body?: string | null
          thread_id?: string | null
          to_addresses?: Json
          uid?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "messaging_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "email_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "email_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      email_sends: {
        Row: {
          automation_id: string | null
          brevo_message_id: string | null
          campaign_id: string | null
          clicked_at: string | null
          client_id: string | null
          created_at: string
          error_message: string | null
          id: string
          opened_at: string | null
          organization_id: string
          recipient_email: string
          recipient_name: string | null
          sent_at: string | null
          sent_by: string | null
          status: string
          subject: string
          template_id: string | null
        }
        Insert: {
          automation_id?: string | null
          brevo_message_id?: string | null
          campaign_id?: string | null
          clicked_at?: string | null
          client_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          opened_at?: string | null
          organization_id: string
          recipient_email: string
          recipient_name?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          subject: string
          template_id?: string | null
        }
        Update: {
          automation_id?: string | null
          brevo_message_id?: string | null
          campaign_id?: string | null
          clicked_at?: string | null
          client_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          opened_at?: string | null
          organization_id?: string
          recipient_email?: string
          recipient_name?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          subject?: string
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_sends_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "email_automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sends_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sends_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sends_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sends_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "email_sends_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "email_sends_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          automation_delay_minutes: number
          automation_enabled: boolean
          automation_trigger_config: Json
          automation_trigger_type: string | null
          category: string | null
          created_at: string | null
          created_by: string | null
          html_content: string
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
          subject: string
          updated_at: string | null
          variables: Json | null
        }
        Insert: {
          automation_delay_minutes?: number
          automation_enabled?: boolean
          automation_trigger_config?: Json
          automation_trigger_type?: string | null
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          html_content?: string
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
          subject: string
          updated_at?: string | null
          variables?: Json | null
        }
        Update: {
          automation_delay_minutes?: number
          automation_enabled?: boolean
          automation_trigger_config?: Json
          automation_trigger_type?: string | null
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          html_content?: string
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
          subject?: string
          updated_at?: string | null
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "email_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      email_unsubscribe_tokens: {
        Row: {
          contact_id: string
          created_at: string
          email_send_id: string | null
          id: string
          organization_id: string
          token: string
          used_at: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string
          email_send_id?: string | null
          id?: string
          organization_id: string
          token: string
          used_at?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string
          email_send_id?: string | null
          id?: string
          organization_id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_unsubscribe_tokens_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "marketing_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_unsubscribe_tokens_email_send_id_fkey"
            columns: ["email_send_id"]
            isOneToOne: false
            referencedRelation: "email_sends"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_unsubscribe_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_unsubscribe_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "email_unsubscribe_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      email_vacation_log: {
        Row: {
          channel_id: string
          id: string
          sent_at: string
          to_address: string
        }
        Insert: {
          channel_id: string
          id?: string
          sent_at?: string
          to_address: string
        }
        Update: {
          channel_id?: string
          id?: string
          sent_at?: string
          to_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_vacation_log_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "messaging_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "expense_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          bank_account_id: string | null
          category_id: string | null
          created_at: string | null
          created_by: string | null
          description: string
          expense_date: string
          id: string
          is_recurring: boolean | null
          next_recurrence_date: string | null
          notes: string | null
          organization_id: string
          receipt_file_url: string | null
          updated_at: string | null
        }
        Insert: {
          amount: number
          bank_account_id?: string | null
          category_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description: string
          expense_date: string
          id?: string
          is_recurring?: boolean | null
          next_recurrence_date?: string | null
          notes?: string | null
          organization_id: string
          receipt_file_url?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          category_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string
          expense_date?: string
          id?: string
          is_recurring?: boolean | null
          next_recurrence_date?: string | null
          notes?: string | null
          organization_id?: string
          receipt_file_url?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "expenses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      forms: {
        Row: {
          ai_qualification_rules: string | null
          assigned_to: string | null
          assigned_user_ids: string[]
          created_at: string | null
          form_settings: Json | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          meta_pixels: Json | null
          msg_template_cold: string | null
          msg_template_hot: string | null
          msg_template_warm: string | null
          name: string
          notify_all_admins: boolean
          organization_id: string
          rotate_enabled: boolean
          round_robin_index: number
          slug: string
          target_stage: string | null
          updated_at: string | null
        }
        Insert: {
          ai_qualification_rules?: string | null
          assigned_to?: string | null
          assigned_user_ids?: string[]
          created_at?: string | null
          form_settings?: Json | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          meta_pixels?: Json | null
          msg_template_cold?: string | null
          msg_template_hot?: string | null
          msg_template_warm?: string | null
          name: string
          notify_all_admins?: boolean
          organization_id: string
          rotate_enabled?: boolean
          round_robin_index?: number
          slug: string
          target_stage?: string | null
          updated_at?: string | null
        }
        Update: {
          ai_qualification_rules?: string | null
          assigned_to?: string | null
          assigned_user_ids?: string[]
          created_at?: string | null
          form_settings?: Json | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          meta_pixels?: Json | null
          msg_template_cold?: string | null
          msg_template_hot?: string | null
          msg_template_warm?: string | null
          name?: string
          notify_all_admins?: boolean
          organization_id?: string
          rotate_enabled?: boolean
          round_robin_index?: number
          slug?: string
          target_stage?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "forms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "forms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      inbox_messages: {
        Row: {
          attachments: Json | null
          chatwoot_account_id: number | null
          contact_name: string | null
          conversation_id: number | null
          created_at: string
          direction: string
          evolution_message_id: string | null
          id: string
          message: string
          message_type: string | null
          organization_id: string | null
          phone: string
        }
        Insert: {
          attachments?: Json | null
          chatwoot_account_id?: number | null
          contact_name?: string | null
          conversation_id?: number | null
          created_at?: string
          direction?: string
          evolution_message_id?: string | null
          id?: string
          message: string
          message_type?: string | null
          organization_id?: string | null
          phone: string
        }
        Update: {
          attachments?: Json | null
          chatwoot_account_id?: number | null
          contact_name?: string | null
          conversation_id?: number | null
          created_at?: string
          direction?: string
          evolution_message_id?: string | null
          id?: string
          message?: string
          message_type?: string | null
          organization_id?: string | null
          phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbox_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "inbox_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      inbox_tasks: {
        Row: {
          assigned_to: string | null
          client_id: string | null
          contact_name: string | null
          contact_phone: string | null
          conversation_id: number | null
          created_at: string | null
          created_by: string | null
          description: string | null
          done_at: string | null
          due_at: string | null
          id: string
          lead_id: string | null
          organization_id: string
          phone_key: string | null
          reminder_sent: boolean
          source_message: string | null
          suggested: boolean
          title: string
        }
        Insert: {
          assigned_to?: string | null
          client_id?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          conversation_id?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          done_at?: string | null
          due_at?: string | null
          id?: string
          lead_id?: string | null
          organization_id: string
          phone_key?: string | null
          reminder_sent?: boolean
          source_message?: string | null
          suggested?: boolean
          title: string
        }
        Update: {
          assigned_to?: string | null
          client_id?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          conversation_id?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          done_at?: string | null
          due_at?: string | null
          id?: string
          lead_id?: string | null
          organization_id?: string
          phone_key?: string | null
          reminder_sent?: boolean
          source_message?: string | null
          suggested?: boolean
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbox_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "inbox_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      internal_requests: {
        Row: {
          amount: number | null
          created_at: string | null
          description: string | null
          expense_date: string | null
          file_url: string | null
          id: string
          organization_id: string
          paid_at: string | null
          payment_reference: string | null
          period_end: string | null
          period_start: string | null
          request_type: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          submitted_at: string | null
          submitted_by: string
          title: string
          updated_at: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string | null
          description?: string | null
          expense_date?: string | null
          file_url?: string | null
          id?: string
          organization_id: string
          paid_at?: string | null
          payment_reference?: string | null
          period_end?: string | null
          period_start?: string | null
          request_type: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          submitted_at?: string | null
          submitted_by: string
          title: string
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string | null
          description?: string | null
          expense_date?: string | null
          file_url?: string | null
          id?: string
          organization_id?: string
          paid_at?: string | null
          payment_reference?: string | null
          period_end?: string | null
          period_start?: string | null
          request_type?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          submitted_at?: string | null
          submitted_by?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "internal_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "internal_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          notes: string | null
          organization_id: string
          product_id: string | null
          quantity: number
          reference_id: string | null
          type: string
          variant_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          product_id?: string | null
          quantity: number
          reference_id?: string | null
          type: string
          variant_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          product_id?: string | null
          quantity?: number
          reference_id?: string | null
          type?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "inventory_movements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "ecommerce_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          client_name: string | null
          created_at: string | null
          date: string | null
          document_type: string | null
          due_date: string | null
          id: string
          invoicexpress_id: number
          organization_id: string
          payment_id: string | null
          pdf_path: string | null
          raw_data: Json | null
          reference: string | null
          sale_id: string | null
          status: string | null
          total: number | null
          updated_at: string | null
        }
        Insert: {
          client_name?: string | null
          created_at?: string | null
          date?: string | null
          document_type?: string | null
          due_date?: string | null
          id?: string
          invoicexpress_id: number
          organization_id: string
          payment_id?: string | null
          pdf_path?: string | null
          raw_data?: Json | null
          reference?: string | null
          sale_id?: string | null
          status?: string | null
          total?: number | null
          updated_at?: string | null
        }
        Update: {
          client_name?: string | null
          created_at?: string | null
          date?: string | null
          document_type?: string | null
          due_date?: string | null
          id?: string
          invoicexpress_id?: number
          organization_id?: string
          payment_id?: string | null
          pdf_path?: string | null
          raw_data?: Json | null
          reference?: string | null
          sale_id?: string | null
          status?: string | null
          total?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "invoices_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "sale_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          file_size: number | null
          file_type: string | null
          id: string
          lead_id: string
          organization_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          lead_id: string
          organization_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          lead_id?: string
          organization_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_attachments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "lead_attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      lead_imports: {
        Row: {
          assignee_ids: string[]
          created_at: string
          file_name: string | null
          first_error: string | null
          id: string
          import_code: string
          imported_by: string
          name: string | null
          organization_id: string
          stage_key: string
          total_failed: number
          total_inserted: number
        }
        Insert: {
          assignee_ids?: string[]
          created_at?: string
          file_name?: string | null
          first_error?: string | null
          id?: string
          import_code: string
          imported_by: string
          name?: string | null
          organization_id: string
          stage_key: string
          total_failed?: number
          total_inserted?: number
        }
        Update: {
          assignee_ids?: string[]
          created_at?: string
          file_name?: string | null
          first_error?: string | null
          id?: string
          import_code?: string
          imported_by?: string
          name?: string | null
          organization_id?: string
          stage_key?: string
          total_failed?: number
          total_inserted?: number
        }
        Relationships: [
          {
            foreignKeyName: "lead_imports_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_imports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_imports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "lead_imports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      lead_intake_webhooks: {
        Row: {
          assigned_user_ids: string[]
          created_at: string
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          notify_all_admins: boolean
          organization_id: string
          rotate_enabled: boolean
          round_robin_index: number
          token: string
          updated_at: string
        }
        Insert: {
          assigned_user_ids?: string[]
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          notify_all_admins?: boolean
          organization_id: string
          rotate_enabled?: boolean
          round_robin_index?: number
          token: string
          updated_at?: string
        }
        Update: {
          assigned_user_ids?: string[]
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          notify_all_admins?: boolean
          organization_id?: string
          rotate_enabled?: boolean
          round_robin_index?: number
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_intake_webhooks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_intake_webhooks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "lead_intake_webhooks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      leads: {
        Row: {
          archived_at: string | null
          assigned_to: string | null
          automation_enabled: boolean
          company_name: string | null
          company_nif: string | null
          consumo_anual: number | null
          created_at: string | null
          custom_data: Json | null
          email: string
          form_id: string | null
          gdpr_consent: boolean
          id: string
          import_id: string | null
          name: string
          notes: string | null
          organization_id: string
          phone: string
          source: string | null
          status: string | null
          temperature: string | null
          tipologia: string | null
          updated_at: string | null
          value: number | null
        }
        Insert: {
          archived_at?: string | null
          assigned_to?: string | null
          automation_enabled?: boolean
          company_name?: string | null
          company_nif?: string | null
          consumo_anual?: number | null
          created_at?: string | null
          custom_data?: Json | null
          email: string
          form_id?: string | null
          gdpr_consent?: boolean
          id?: string
          import_id?: string | null
          name: string
          notes?: string | null
          organization_id: string
          phone: string
          source?: string | null
          status?: string | null
          temperature?: string | null
          tipologia?: string | null
          updated_at?: string | null
          value?: number | null
        }
        Update: {
          archived_at?: string | null
          assigned_to?: string | null
          automation_enabled?: boolean
          company_name?: string | null
          company_nif?: string | null
          consumo_anual?: number | null
          created_at?: string | null
          custom_data?: Json | null
          email?: string
          form_id?: string | null
          gdpr_consent?: boolean
          id?: string
          import_id?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string
          source?: string | null
          status?: string | null
          temperature?: string | null
          tipologia?: string | null
          updated_at?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "lead_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      leads_backup_dups_20260521: {
        Row: {
          assigned_to: string | null
          automation_enabled: boolean | null
          company_name: string | null
          company_nif: string | null
          consumo_anual: number | null
          created_at: string | null
          custom_data: Json | null
          email: string | null
          form_id: string | null
          gdpr_consent: boolean | null
          id: string | null
          import_id: string | null
          name: string | null
          notes: string | null
          organization_id: string | null
          phone: string | null
          source: string | null
          status: string | null
          temperature: string | null
          tipologia: string | null
          updated_at: string | null
          value: number | null
        }
        Insert: {
          assigned_to?: string | null
          automation_enabled?: boolean | null
          company_name?: string | null
          company_nif?: string | null
          consumo_anual?: number | null
          created_at?: string | null
          custom_data?: Json | null
          email?: string | null
          form_id?: string | null
          gdpr_consent?: boolean | null
          id?: string | null
          import_id?: string | null
          name?: string | null
          notes?: string | null
          organization_id?: string | null
          phone?: string | null
          source?: string | null
          status?: string | null
          temperature?: string | null
          tipologia?: string | null
          updated_at?: string | null
          value?: number | null
        }
        Update: {
          assigned_to?: string | null
          automation_enabled?: boolean | null
          company_name?: string | null
          company_nif?: string | null
          consumo_anual?: number | null
          created_at?: string | null
          custom_data?: Json | null
          email?: string | null
          form_id?: string | null
          gdpr_consent?: boolean | null
          id?: string | null
          import_id?: string | null
          name?: string | null
          notes?: string | null
          organization_id?: string | null
          phone?: string | null
          source?: string | null
          status?: string | null
          temperature?: string | null
          tipologia?: string | null
          updated_at?: string | null
          value?: number | null
        }
        Relationships: []
      }
      leads_backup_import_b10cc0c1: {
        Row: {
          assigned_to: string | null
          automation_enabled: boolean | null
          company_name: string | null
          company_nif: string | null
          consumo_anual: number | null
          created_at: string | null
          custom_data: Json | null
          email: string | null
          form_id: string | null
          gdpr_consent: boolean | null
          id: string | null
          import_id: string | null
          name: string | null
          notes: string | null
          organization_id: string | null
          phone: string | null
          source: string | null
          status: string | null
          temperature: string | null
          tipologia: string | null
          updated_at: string | null
          value: number | null
        }
        Insert: {
          assigned_to?: string | null
          automation_enabled?: boolean | null
          company_name?: string | null
          company_nif?: string | null
          consumo_anual?: number | null
          created_at?: string | null
          custom_data?: Json | null
          email?: string | null
          form_id?: string | null
          gdpr_consent?: boolean | null
          id?: string | null
          import_id?: string | null
          name?: string | null
          notes?: string | null
          organization_id?: string | null
          phone?: string | null
          source?: string | null
          status?: string | null
          temperature?: string | null
          tipologia?: string | null
          updated_at?: string | null
          value?: number | null
        }
        Update: {
          assigned_to?: string | null
          automation_enabled?: boolean | null
          company_name?: string | null
          company_nif?: string | null
          consumo_anual?: number | null
          created_at?: string | null
          custom_data?: Json | null
          email?: string | null
          form_id?: string | null
          gdpr_consent?: boolean | null
          id?: string | null
          import_id?: string | null
          name?: string | null
          notes?: string | null
          organization_id?: string | null
          phone?: string | null
          source?: string | null
          status?: string | null
          temperature?: string | null
          tipologia?: string | null
          updated_at?: string | null
          value?: number | null
        }
        Relationships: []
      }
      marketing_contacts: {
        Row: {
          company: string | null
          converted_to_lead: boolean
          created_at: string
          email: string | null
          id: string
          name: string
          organization_id: string
          phone: string | null
          source: string | null
          subscribed: boolean | null
          tags: Json | null
          updated_at: string
        }
        Insert: {
          company?: string | null
          converted_to_lead?: boolean
          created_at?: string
          email?: string | null
          id?: string
          name: string
          organization_id: string
          phone?: string | null
          source?: string | null
          subscribed?: boolean | null
          tags?: Json | null
          updated_at?: string
        }
        Update: {
          company?: string | null
          converted_to_lead?: boolean
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          organization_id?: string
          phone?: string | null
          source?: string | null
          subscribed?: boolean | null
          tags?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "marketing_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      marketing_list_members: {
        Row: {
          added_at: string
          contact_id: string
          id: string
          list_id: string
        }
        Insert: {
          added_at?: string
          contact_id: string
          id?: string
          list_id: string
        }
        Update: {
          added_at?: string
          contact_id?: string
          id?: string
          list_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_list_members_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "marketing_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_list_members_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "client_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      messaging_channel_secrets: {
        Row: {
          channel_id: string
          imap_password: string | null
          organization_id: string
          page_access_token: string | null
          smtp_password: string | null
          updated_at: string
        }
        Insert: {
          channel_id: string
          imap_password?: string | null
          organization_id: string
          page_access_token?: string | null
          smtp_password?: string | null
          updated_at?: string
        }
        Update: {
          channel_id?: string
          imap_password?: string | null
          organization_id?: string
          page_access_token?: string | null
          smtp_password?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messaging_channel_secrets_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: true
            referencedRelation: "messaging_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messaging_channel_secrets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messaging_channel_secrets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "messaging_channel_secrets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      messaging_channels: {
        Row: {
          assigned_user_ids: string[]
          channel_type: string
          chatwoot_inbox_id: number | null
          color: string | null
          created_at: string | null
          evolution_instance: string | null
          flap_count: number
          flap_window_start: string | null
          id: string
          label: string | null
          metadata: Json | null
          metadata_public: Json | null
          needs_repair: boolean
          organization_id: string
          phone_number: string | null
          provider: string
          rotate_enabled: boolean
          round_robin_index: number
          status: string
          updated_at: string | null
        }
        Insert: {
          assigned_user_ids?: string[]
          channel_type: string
          chatwoot_inbox_id?: number | null
          color?: string | null
          created_at?: string | null
          evolution_instance?: string | null
          flap_count?: number
          flap_window_start?: string | null
          id?: string
          label?: string | null
          metadata?: Json | null
          metadata_public?: Json | null
          needs_repair?: boolean
          organization_id: string
          phone_number?: string | null
          provider: string
          rotate_enabled?: boolean
          round_robin_index?: number
          status?: string
          updated_at?: string | null
        }
        Update: {
          assigned_user_ids?: string[]
          channel_type?: string
          chatwoot_inbox_id?: number | null
          color?: string | null
          created_at?: string | null
          evolution_instance?: string | null
          flap_count?: number
          flap_window_start?: string | null
          id?: string
          label?: string | null
          metadata?: Json | null
          metadata_public?: Json | null
          needs_repair?: boolean
          organization_id?: string
          phone_number?: string | null
          provider?: string
          rotate_enabled?: boolean
          round_robin_index?: number
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messaging_channels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messaging_channels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "messaging_channels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      meta_conversations: {
        Row: {
          assigned_to: string | null
          channel_id: string
          client_id: string | null
          contact_avatar_url: string | null
          contact_meta: Json | null
          contact_name: string | null
          contact_ref: string
          created_at: string
          id: string
          last_message: string | null
          last_message_at: string | null
          lead_id: string | null
          organization_id: string
          source_ref: Json | null
          status: string
          unread_count: number
          updated_at: string
          window_expires_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          channel_id: string
          client_id?: string | null
          contact_avatar_url?: string | null
          contact_meta?: Json | null
          contact_name?: string | null
          contact_ref: string
          created_at?: string
          id?: string
          last_message?: string | null
          last_message_at?: string | null
          lead_id?: string | null
          organization_id: string
          source_ref?: Json | null
          status?: string
          unread_count?: number
          updated_at?: string
          window_expires_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          channel_id?: string
          client_id?: string | null
          contact_avatar_url?: string | null
          contact_meta?: Json | null
          contact_name?: string | null
          contact_ref?: string
          created_at?: string
          id?: string
          last_message?: string | null
          last_message_at?: string | null
          lead_id?: string | null
          organization_id?: string
          source_ref?: Json | null
          status?: string
          unread_count?: number
          updated_at?: string
          window_expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_conversations_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "messaging_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_conversations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "meta_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      meta_data_deletion_requests: {
        Row: {
          confirmation_code: string
          created_at: string
          deleted_conversations: number
          deleted_messages: number
          error: string | null
          id: string
          meta_user_id: string
          payload: Json | null
          processed_at: string | null
          status: string
        }
        Insert: {
          confirmation_code: string
          created_at?: string
          deleted_conversations?: number
          deleted_messages?: number
          error?: string | null
          id?: string
          meta_user_id: string
          payload?: Json | null
          processed_at?: string | null
          status?: string
        }
        Update: {
          confirmation_code?: string
          created_at?: string
          deleted_conversations?: number
          deleted_messages?: number
          error?: string | null
          id?: string
          meta_user_id?: string
          payload?: Json | null
          processed_at?: string | null
          status?: string
        }
        Relationships: []
      }
      meta_messages: {
        Row: {
          attachments: Json
          content: string | null
          conversation_id: string
          created_at: string
          direction: string
          external_id: string | null
          id: string
          is_deleted: boolean
          organization_id: string
          reaction: string | null
          reaction_by: string | null
          reply_to_external_id: string | null
          sent_at: string | null
          sent_by: string | null
        }
        Insert: {
          attachments?: Json
          content?: string | null
          conversation_id: string
          created_at?: string
          direction: string
          external_id?: string | null
          id?: string
          is_deleted?: boolean
          organization_id: string
          reaction?: string | null
          reaction_by?: string | null
          reply_to_external_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
        }
        Update: {
          attachments?: Json
          content?: string | null
          conversation_id?: string
          created_at?: string
          direction?: string
          external_id?: string | null
          id?: string
          is_deleted?: boolean
          organization_id?: string
          reaction?: string | null
          reaction_by?: string | null
          reply_to_external_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "meta_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "meta_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      meta_webhook_log: {
        Row: {
          body_head: string | null
          id: string
          method: string | null
          note: string | null
          organization_id: string | null
          outcome: string | null
          page_id: string | null
          received_at: string
          valid_sig: boolean | null
        }
        Insert: {
          body_head?: string | null
          id?: string
          method?: string | null
          note?: string | null
          organization_id?: string | null
          outcome?: string | null
          page_id?: string | null
          received_at?: string
          valid_sig?: boolean | null
        }
        Update: {
          body_head?: string | null
          id?: string
          method?: string | null
          note?: string | null
          organization_id?: string | null
          outcome?: string | null
          page_id?: string | null
          received_at?: string
          valid_sig?: boolean | null
        }
        Relationships: []
      }
      monthly_commitments: {
        Row: {
          created_at: string
          id: string
          month: string
          organization_id: string
          total_comissao: number
          total_energia_mwh: number
          total_nifs: number
          total_solar_kwp: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          month: string
          organization_id: string
          total_comissao?: number
          total_energia_mwh?: number
          total_nifs?: number
          total_solar_kwp?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          month?: string
          organization_id?: string
          total_comissao?: number
          total_energia_mwh?: number
          total_nifs?: number
          total_solar_kwp?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_commitments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_commitments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "monthly_commitments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "monthly_commitments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_metrics: {
        Row: {
          comissao: number
          created_at: string
          created_by: string | null
          energia: number
          id: string
          month: string
          op_comissao: number
          op_energia: number
          op_solar: number
          organization_id: string
          solar: number
          updated_at: string
          user_id: string
        }
        Insert: {
          comissao?: number
          created_at?: string
          created_by?: string | null
          energia?: number
          id?: string
          month: string
          op_comissao?: number
          op_energia?: number
          op_solar?: number
          organization_id: string
          solar?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          comissao?: number
          created_at?: string
          created_by?: string | null
          energia?: number
          id?: string
          month?: string
          op_comissao?: number
          op_energia?: number
          op_solar?: number
          organization_id?: string
          solar?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_metrics_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_metrics_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "monthly_metrics_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      monthly_objectives: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          month: string
          organization_id: string
          total_comissao: number
          total_energia_mwh: number
          total_nifs: number
          total_solar_kwp: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          month: string
          organization_id: string
          total_comissao?: number
          total_energia_mwh?: number
          total_nifs?: number
          total_solar_kwp?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          month?: string
          organization_id?: string
          total_comissao?: number
          total_energia_mwh?: number
          total_nifs?: number
          total_solar_kwp?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_objectives_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_objectives_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "monthly_objectives_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string | null
          id: string
          order_id: string
          product_id: string | null
          product_name: string
          quantity: number
          sku: string | null
          total: number
          unit_price: number
          variant_id: string | null
          variant_name: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          order_id: string
          product_id?: string | null
          product_name: string
          quantity?: number
          sku?: string | null
          total: number
          unit_price: number
          variant_id?: string | null
          variant_name?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          order_id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          sku?: string | null
          total?: number
          unit_price?: number
          variant_id?: string | null
          variant_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "ecommerce_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          billing_address: Json | null
          created_at: string | null
          customer_id: string | null
          discount_code: string | null
          discount_total: number | null
          fulfillment_status: string | null
          id: string
          internal_notes: string | null
          lead_id: string | null
          notes: string | null
          order_number: string
          organization_id: string
          payment_status: string | null
          shipping_address: Json | null
          shipping_total: number | null
          status: string | null
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          subtotal: number
          tax_total: number | null
          total: number
          updated_at: string | null
        }
        Insert: {
          billing_address?: Json | null
          created_at?: string | null
          customer_id?: string | null
          discount_code?: string | null
          discount_total?: number | null
          fulfillment_status?: string | null
          id?: string
          internal_notes?: string | null
          lead_id?: string | null
          notes?: string | null
          order_number: string
          organization_id: string
          payment_status?: string | null
          shipping_address?: Json | null
          shipping_total?: number | null
          status?: string | null
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          subtotal?: number
          tax_total?: number | null
          total?: number
          updated_at?: string | null
        }
        Update: {
          billing_address?: Json | null
          created_at?: string | null
          customer_id?: string | null
          discount_code?: string | null
          discount_total?: number | null
          fulfillment_status?: string | null
          id?: string
          internal_notes?: string | null
          lead_id?: string | null
          notes?: string | null
          order_number?: string
          organization_id?: string
          payment_status?: string | null
          shipping_address?: Json | null
          shipping_total?: number | null
          status?: string | null
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          subtotal?: number
          tax_total?: number | null
          total?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      org_onboarding_state: {
        Row: {
          completed_at: string | null
          current_stage: string
          dismissed: boolean
          module_dismissed: Json
          organization_id: string
          stages_completed: string[]
          started_at: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          current_stage?: string
          dismissed?: boolean
          module_dismissed?: Json
          organization_id: string
          stages_completed?: string[]
          started_at?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          current_stage?: string
          dismissed?: boolean
          module_dismissed?: Json
          organization_id?: string
          stages_completed?: string[]
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_onboarding_state_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_onboarding_state_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "org_onboarding_state_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      organization_invites: {
        Row: {
          created_at: string | null
          email: string
          expires_at: string | null
          id: string
          invited_by: string | null
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
          token: string
        }
        Insert: {
          created_at?: string | null
          email: string
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
        }
        Update: {
          created_at?: string | null
          email?: string
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organization_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      organization_members: {
        Row: {
          commission_rate: number | null
          id: string
          is_active: boolean
          joined_at: string | null
          organization_id: string
          paused_until: string | null
          profile_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          commission_rate?: number | null
          id?: string
          is_active?: boolean
          joined_at?: string | null
          organization_id: string
          paused_until?: string | null
          profile_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          commission_rate?: number | null
          id?: string
          is_active?: boolean
          joined_at?: string | null
          organization_id?: string
          paused_until?: string | null
          profile_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organization_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "organization_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_profiles: {
        Row: {
          base_role: Database["public"]["Enums"]["app_role"]
          created_at: string
          dashboard_widgets: Json | null
          data_scope: string
          id: string
          is_default: boolean
          module_permissions: Json
          name: string
          organization_id: string
        }
        Insert: {
          base_role?: Database["public"]["Enums"]["app_role"]
          created_at?: string
          dashboard_widgets?: Json | null
          data_scope?: string
          id?: string
          is_default?: boolean
          module_permissions?: Json
          name: string
          organization_id: string
        }
        Update: {
          base_role?: Database["public"]["Enums"]["app_role"]
          created_at?: string
          dashboard_widgets?: Json | null
          data_scope?: string
          id?: string
          is_default?: boolean
          module_permissions?: Json
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organization_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      organization_webhooks: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          organization_id: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          organization_id: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_webhooks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_webhooks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "organization_webhooks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      organizations: {
        Row: {
          ai_qualification_rules: string | null
          ai_response_mode: string
          billing_exempt: boolean | null
          billing_provider: string | null
          brevo_api_key: string | null
          brevo_sender_email: string | null
          calendar_alert_settings: Json | null
          chatwoot_account_id: number | null
          chatwoot_account_token: string | null
          chatwoot_webhook_secret: string | null
          client_fields_settings: Json | null
          code: string | null
          commission_matrix: Json | null
          contact_phone: string | null
          created_at: string | null
          current_period_end: string | null
          enabled_modules: Json | null
          extra_seats: number | null
          extra_seats_stripe_price_id: string | null
          fidelization_alert_days: Json | null
          fidelization_create_event: boolean | null
          fidelization_email: string | null
          fidelization_email_enabled: boolean | null
          fidelization_event_time: string | null
          finance_email: string | null
          first_client_at: string | null
          first_inbox_reply_at: string | null
          first_lead_at: string | null
          first_paid_at: string | null
          first_proposal_at: string | null
          first_sale_at: string | null
          form_settings: Json | null
          id: string
          integrations_enabled: Json | null
          invoicexpress_account_name: string | null
          invoicexpress_api_key: string | null
          keyinvoice_api_url: string | null
          keyinvoice_company_code: string | null
          keyinvoice_password: string | null
          keyinvoice_sid: string | null
          keyinvoice_sid_expires_at: string | null
          keyinvoice_token: string | null
          keyinvoice_token_expires_at: string | null
          keyinvoice_username: string | null
          last_active_at: string | null
          lead_fields_settings: Json | null
          logo_url: string | null
          max_inboxes_override: number | null
          max_users_override: number | null
          meta_conversions_api_token: string | null
          meta_pixels: Json | null
          msg_template_cold: string | null
          msg_template_hot: string | null
          msg_template_warm: string | null
          name: string
          niche: string | null
          payment_failed_at: string | null
          plan: string | null
          proposal_fields_settings: Json | null
          public_key: string
          sale_fields_settings: Json | null
          sales_settings: Json | null
          servicos_products_config: Json | null
          slug: string
          tax_config: Json | null
          tem_vendus_api_key: boolean
          trial_ends_at: string | null
          trial_notified_at: string | null
          trial_reminders_sent: Json
          vendus_api_key: string | null
          vendus_payment_method_id: number | null
          vendus_register_id: number | null
          wa_nudge_count: number
          wa_nudge_last_sent_at: string | null
          wa_nudge_optout: boolean
          webhook_dedicated_user_id: string | null
          webhook_token: string
          webhook_token_dedicated: string | null
          webhook_url: string | null
          whatsapp_api_key: string | null
          whatsapp_base_url: string | null
          whatsapp_instance: string | null
        }
        Insert: {
          ai_qualification_rules?: string | null
          ai_response_mode?: string
          billing_exempt?: boolean | null
          billing_provider?: string | null
          brevo_api_key?: string | null
          brevo_sender_email?: string | null
          calendar_alert_settings?: Json | null
          chatwoot_account_id?: number | null
          chatwoot_account_token?: string | null
          chatwoot_webhook_secret?: string | null
          client_fields_settings?: Json | null
          code?: string | null
          commission_matrix?: Json | null
          contact_phone?: string | null
          created_at?: string | null
          current_period_end?: string | null
          enabled_modules?: Json | null
          extra_seats?: number | null
          extra_seats_stripe_price_id?: string | null
          fidelization_alert_days?: Json | null
          fidelization_create_event?: boolean | null
          fidelization_email?: string | null
          fidelization_email_enabled?: boolean | null
          fidelization_event_time?: string | null
          finance_email?: string | null
          first_client_at?: string | null
          first_inbox_reply_at?: string | null
          first_lead_at?: string | null
          first_paid_at?: string | null
          first_proposal_at?: string | null
          first_sale_at?: string | null
          form_settings?: Json | null
          id?: string
          integrations_enabled?: Json | null
          invoicexpress_account_name?: string | null
          invoicexpress_api_key?: string | null
          keyinvoice_api_url?: string | null
          keyinvoice_company_code?: string | null
          keyinvoice_password?: string | null
          keyinvoice_sid?: string | null
          keyinvoice_sid_expires_at?: string | null
          keyinvoice_token?: string | null
          keyinvoice_token_expires_at?: string | null
          keyinvoice_username?: string | null
          last_active_at?: string | null
          lead_fields_settings?: Json | null
          logo_url?: string | null
          max_inboxes_override?: number | null
          max_users_override?: number | null
          meta_conversions_api_token?: string | null
          meta_pixels?: Json | null
          msg_template_cold?: string | null
          msg_template_hot?: string | null
          msg_template_warm?: string | null
          name: string
          niche?: string | null
          payment_failed_at?: string | null
          plan?: string | null
          proposal_fields_settings?: Json | null
          public_key?: string
          sale_fields_settings?: Json | null
          sales_settings?: Json | null
          servicos_products_config?: Json | null
          slug: string
          tax_config?: Json | null
          trial_ends_at?: string | null
          trial_notified_at?: string | null
          trial_reminders_sent?: Json
          vendus_api_key?: string | null
          vendus_payment_method_id?: number | null
          vendus_register_id?: number | null
          wa_nudge_count?: number
          wa_nudge_last_sent_at?: string | null
          wa_nudge_optout?: boolean
          webhook_dedicated_user_id?: string | null
          webhook_token?: string
          webhook_token_dedicated?: string | null
          webhook_url?: string | null
          whatsapp_api_key?: string | null
          whatsapp_base_url?: string | null
          whatsapp_instance?: string | null
        }
        Update: {
          ai_qualification_rules?: string | null
          ai_response_mode?: string
          billing_exempt?: boolean | null
          billing_provider?: string | null
          brevo_api_key?: string | null
          brevo_sender_email?: string | null
          calendar_alert_settings?: Json | null
          chatwoot_account_id?: number | null
          chatwoot_account_token?: string | null
          chatwoot_webhook_secret?: string | null
          client_fields_settings?: Json | null
          code?: string | null
          commission_matrix?: Json | null
          contact_phone?: string | null
          created_at?: string | null
          current_period_end?: string | null
          enabled_modules?: Json | null
          extra_seats?: number | null
          extra_seats_stripe_price_id?: string | null
          fidelization_alert_days?: Json | null
          fidelization_create_event?: boolean | null
          fidelization_email?: string | null
          fidelization_email_enabled?: boolean | null
          fidelization_event_time?: string | null
          finance_email?: string | null
          first_client_at?: string | null
          first_inbox_reply_at?: string | null
          first_lead_at?: string | null
          first_paid_at?: string | null
          first_proposal_at?: string | null
          first_sale_at?: string | null
          form_settings?: Json | null
          id?: string
          integrations_enabled?: Json | null
          invoicexpress_account_name?: string | null
          invoicexpress_api_key?: string | null
          keyinvoice_api_url?: string | null
          keyinvoice_company_code?: string | null
          keyinvoice_password?: string | null
          keyinvoice_sid?: string | null
          keyinvoice_sid_expires_at?: string | null
          keyinvoice_token?: string | null
          keyinvoice_token_expires_at?: string | null
          keyinvoice_username?: string | null
          last_active_at?: string | null
          lead_fields_settings?: Json | null
          logo_url?: string | null
          max_inboxes_override?: number | null
          max_users_override?: number | null
          meta_conversions_api_token?: string | null
          meta_pixels?: Json | null
          msg_template_cold?: string | null
          msg_template_hot?: string | null
          msg_template_warm?: string | null
          name?: string
          niche?: string | null
          payment_failed_at?: string | null
          plan?: string | null
          proposal_fields_settings?: Json | null
          public_key?: string
          sale_fields_settings?: Json | null
          sales_settings?: Json | null
          servicos_products_config?: Json | null
          slug?: string
          tax_config?: Json | null
          trial_ends_at?: string | null
          trial_notified_at?: string | null
          trial_reminders_sent?: Json
          vendus_api_key?: string | null
          vendus_payment_method_id?: number | null
          vendus_register_id?: number | null
          wa_nudge_count?: number
          wa_nudge_last_sent_at?: string | null
          wa_nudge_optout?: boolean
          webhook_dedicated_user_id?: string | null
          webhook_token?: string
          webhook_token_dedicated?: string | null
          webhook_url?: string | null
          whatsapp_api_key?: string | null
          whatsapp_base_url?: string | null
          whatsapp_instance?: string | null
        }
        Relationships: []
      }
      otto_action_log: {
        Row: {
          args: Json | null
          created_at: string
          id: string
          organization_id: string
          result: Json | null
          success: boolean
          tool: string
          user_id: string | null
        }
        Insert: {
          args?: Json | null
          created_at?: string
          id?: string
          organization_id: string
          result?: Json | null
          success?: boolean
          tool: string
          user_id?: string | null
        }
        Update: {
          args?: Json | null
          created_at?: string
          id?: string
          organization_id?: string
          result?: Json | null
          success?: boolean
          tool?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "otto_action_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "otto_action_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "otto_action_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          color: string
          created_at: string | null
          id: string
          is_final_negative: boolean | null
          is_final_positive: boolean | null
          key: string
          name: string
          organization_id: string
          position: number
          updated_at: string | null
        }
        Insert: {
          color?: string
          created_at?: string | null
          id?: string
          is_final_negative?: boolean | null
          is_final_positive?: boolean | null
          key: string
          name: string
          organization_id: string
          position?: number
          updated_at?: string | null
        }
        Update: {
          color?: string
          created_at?: string | null
          id?: string
          is_final_negative?: boolean | null
          is_final_positive?: boolean | null
          key?: string
          name?: string
          organization_id?: string
          position?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_stages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "pipeline_stages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      product_categories: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          name: string
          organization_id: string
          parent_id: string | null
          position: number | null
          slug: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name: string
          organization_id: string
          parent_id?: string | null
          position?: number | null
          slug: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name?: string
          organization_id?: string
          parent_id?: string | null
          position?: number | null
          slug?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "product_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "product_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      product_images: {
        Row: {
          alt_text: string | null
          created_at: string | null
          id: string
          is_primary: boolean | null
          position: number | null
          product_id: string
          url: string
        }
        Insert: {
          alt_text?: string | null
          created_at?: string | null
          id?: string
          is_primary?: boolean | null
          position?: number | null
          product_id: string
          url: string
        }
        Update: {
          alt_text?: string | null
          created_at?: string | null
          id?: string
          is_primary?: boolean | null
          position?: number | null
          product_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "ecommerce_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          compare_at_price: number | null
          created_at: string | null
          id: string
          is_active: boolean | null
          low_stock_threshold: number | null
          name: string
          options: Json | null
          price: number
          product_id: string
          sku: string | null
          stock_quantity: number | null
          updated_at: string | null
          weight_grams: number | null
        }
        Insert: {
          compare_at_price?: number | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          low_stock_threshold?: number | null
          name: string
          options?: Json | null
          price: number
          product_id: string
          sku?: string | null
          stock_quantity?: number | null
          updated_at?: string | null
          weight_grams?: number | null
        }
        Update: {
          compare_at_price?: number | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          low_stock_threshold?: number | null
          name?: string
          options?: Json | null
          price?: number
          product_id?: string
          sku?: string | null
          stock_quantity?: number | null
          updated_at?: string | null
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "ecommerce_products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category_id: string | null
          code: string | null
          commission_renewal_value: number | null
          commission_value: number | null
          compare_at_price: number | null
          created_at: string | null
          description: string | null
          id: string
          invoicexpress_id: number | null
          is_active: boolean | null
          is_digital: boolean | null
          is_ecommerce: boolean | null
          is_recurring: boolean | null
          keyinvoice_product_id: string | null
          low_stock_threshold: number | null
          name: string
          organization_id: string
          price: number | null
          price_includes_vat: boolean
          requires_shipping: boolean | null
          retention_rate: number
          short_description: string | null
          sku: string | null
          slug: string | null
          stock_quantity: number | null
          tags: string[] | null
          tax_exemption_reason: string | null
          tax_value: number | null
          track_inventory: boolean | null
          updated_at: string | null
          weight_grams: number | null
        }
        Insert: {
          category_id?: string | null
          code?: string | null
          commission_renewal_value?: number | null
          commission_value?: number | null
          compare_at_price?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          invoicexpress_id?: number | null
          is_active?: boolean | null
          is_digital?: boolean | null
          is_ecommerce?: boolean | null
          is_recurring?: boolean | null
          keyinvoice_product_id?: string | null
          low_stock_threshold?: number | null
          name: string
          organization_id: string
          price?: number | null
          price_includes_vat?: boolean
          requires_shipping?: boolean | null
          retention_rate?: number
          short_description?: string | null
          sku?: string | null
          slug?: string | null
          stock_quantity?: number | null
          tags?: string[] | null
          tax_exemption_reason?: string | null
          tax_value?: number | null
          track_inventory?: boolean | null
          updated_at?: string | null
          weight_grams?: number | null
        }
        Update: {
          category_id?: string | null
          code?: string | null
          commission_renewal_value?: number | null
          commission_value?: number | null
          compare_at_price?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          invoicexpress_id?: number | null
          is_active?: boolean | null
          is_digital?: boolean | null
          is_ecommerce?: boolean | null
          is_recurring?: boolean | null
          keyinvoice_product_id?: string | null
          low_stock_threshold?: number | null
          name?: string
          organization_id?: string
          price?: number | null
          price_includes_vat?: boolean
          requires_shipping?: boolean | null
          retention_rate?: number
          short_description?: string | null
          sku?: string | null
          slug?: string | null
          stock_quantity?: number | null
          tags?: string[] | null
          tax_exemption_reason?: string | null
          tax_value?: number | null
          track_inventory?: boolean | null
          updated_at?: string | null
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          brevo_sender_email: string | null
          created_at: string | null
          email: string | null
          email_signature: string | null
          full_name: string
          id: string
          organization_id: string | null
          phone: string | null
        }
        Insert: {
          avatar_url?: string | null
          brevo_sender_email?: string | null
          created_at?: string | null
          email?: string | null
          email_signature?: string | null
          full_name: string
          id: string
          organization_id?: string | null
          phone?: string | null
        }
        Update: {
          avatar_url?: string | null
          brevo_sender_email?: string | null
          created_at?: string | null
          email?: string | null
          email_signature?: string | null
          full_name?: string
          id?: string
          organization_id?: string | null
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      proposal_cpes: {
        Row: {
          comercializador: string
          comissao: number | null
          consumo_anual: number | null
          contrato_fim: string | null
          contrato_inicio: string | null
          created_at: string
          dbl: number | null
          duracao_contrato: number | null
          equipment_type: string
          existing_cpe_id: string | null
          fidelizacao_end: string | null
          fidelizacao_start: string | null
          id: string
          margem: number | null
          notes: string | null
          proposal_id: string
          serial_number: string | null
        }
        Insert: {
          comercializador: string
          comissao?: number | null
          consumo_anual?: number | null
          contrato_fim?: string | null
          contrato_inicio?: string | null
          created_at?: string
          dbl?: number | null
          duracao_contrato?: number | null
          equipment_type: string
          existing_cpe_id?: string | null
          fidelizacao_end?: string | null
          fidelizacao_start?: string | null
          id?: string
          margem?: number | null
          notes?: string | null
          proposal_id: string
          serial_number?: string | null
        }
        Update: {
          comercializador?: string
          comissao?: number | null
          consumo_anual?: number | null
          contrato_fim?: string | null
          contrato_inicio?: string | null
          created_at?: string
          dbl?: number | null
          duracao_contrato?: number | null
          equipment_type?: string
          existing_cpe_id?: string | null
          fidelizacao_end?: string | null
          fidelizacao_start?: string | null
          id?: string
          margem?: number | null
          notes?: string | null
          proposal_id?: string
          serial_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proposal_cpes_existing_cpe_id_fkey"
            columns: ["existing_cpe_id"]
            isOneToOne: false
            referencedRelation: "cpes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_cpes_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_products: {
        Row: {
          created_at: string | null
          id: string
          product_id: string
          proposal_id: string
          quantity: number
          total: number
          unit_price: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          product_id: string
          proposal_id: string
          quantity?: number
          total: number
          unit_price: number
        }
        Update: {
          created_at?: string | null
          id?: string
          product_id?: string
          proposal_id?: string
          quantity?: number
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "proposal_products_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      proposals: {
        Row: {
          accepted_at: string | null
          anos_contrato: number | null
          client_id: string | null
          code: string | null
          comissao: number | null
          consumo_anual: number | null
          created_at: string | null
          created_by: string | null
          dbl: number | null
          id: string
          kwp: number | null
          lead_id: string | null
          margem: number | null
          modelo_servico: string | null
          negotiation_type: string | null
          notes: string | null
          organization_id: string
          proposal_date: string | null
          proposal_type: string | null
          servicos_details: Json | null
          servicos_produtos: string[] | null
          status: string
          total_value: number
          updated_at: string | null
        }
        Insert: {
          accepted_at?: string | null
          anos_contrato?: number | null
          client_id?: string | null
          code?: string | null
          comissao?: number | null
          consumo_anual?: number | null
          created_at?: string | null
          created_by?: string | null
          dbl?: number | null
          id?: string
          kwp?: number | null
          lead_id?: string | null
          margem?: number | null
          modelo_servico?: string | null
          negotiation_type?: string | null
          notes?: string | null
          organization_id: string
          proposal_date?: string | null
          proposal_type?: string | null
          servicos_details?: Json | null
          servicos_produtos?: string[] | null
          status?: string
          total_value?: number
          updated_at?: string | null
        }
        Update: {
          accepted_at?: string | null
          anos_contrato?: number | null
          client_id?: string | null
          code?: string | null
          comissao?: number | null
          consumo_anual?: number | null
          created_at?: string | null
          created_by?: string | null
          dbl?: number | null
          id?: string
          kwp?: number | null
          lead_id?: string | null
          margem?: number | null
          modelo_servico?: string | null
          negotiation_type?: string | null
          notes?: string | null
          organization_id?: string
          proposal_date?: string | null
          proposal_type?: string | null
          servicos_details?: Json | null
          servicos_produtos?: string[] | null
          status?: string
          total_value?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proposals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_generation_jobs: {
        Row: {
          apify_run_id: string | null
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          organization_id: string
          result: Json | null
          search_params: Json | null
          status: string
          user_id: string
        }
        Insert: {
          apify_run_id?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          organization_id: string
          result?: Json | null
          search_params?: Json | null
          status?: string
          user_id: string
        }
        Update: {
          apify_run_id?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          organization_id?: string
          result?: Json | null
          search_params?: Json | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_generation_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_generation_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "prospect_generation_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      prospects: {
        Row: {
          annual_consumption_kwh: number | null
          assigned_at: string | null
          assigned_to: string | null
          company_name: string
          contact_name: string | null
          converted_at: string | null
          converted_lead_id: string | null
          converted_to_lead: boolean
          cpe: string | null
          created_at: string
          email: string | null
          id: string
          imported_at: string
          imported_by: string | null
          metadata: Json
          nif: string | null
          observations: string | null
          organization_id: string
          phone: string | null
          segment: string | null
          source: string
          source_file_name: string | null
          status: string
          updated_at: string
        }
        Insert: {
          annual_consumption_kwh?: number | null
          assigned_at?: string | null
          assigned_to?: string | null
          company_name: string
          contact_name?: string | null
          converted_at?: string | null
          converted_lead_id?: string | null
          converted_to_lead?: boolean
          cpe?: string | null
          created_at?: string
          email?: string | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          metadata?: Json
          nif?: string | null
          observations?: string | null
          organization_id: string
          phone?: string | null
          segment?: string | null
          source?: string
          source_file_name?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          annual_consumption_kwh?: number | null
          assigned_at?: string | null
          assigned_to?: string | null
          company_name?: string
          contact_name?: string | null
          converted_at?: string | null
          converted_lead_id?: string | null
          converted_to_lead?: boolean
          cpe?: string | null
          created_at?: string
          email?: string | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          metadata?: Json
          nif?: string | null
          observations?: string | null
          organization_id?: string
          phone?: string | null
          segment?: string | null
          source?: string
          source_file_name?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "prospects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string | null
          endpoint: string
          id: string
          muted_conversation_ids: number[]
          organization_id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string | null
          endpoint: string
          id?: string
          muted_conversation_ids?: number[]
          organization_id: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string | null
          endpoint?: string
          id?: string
          muted_conversation_ids?: number[]
          organization_id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "push_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      renewal_automation_runs: {
        Row: {
          created_at: string
          failed_at: string | null
          id: string
          last_error: string | null
          organization_id: string
          renewal_date: string
          renewal_payment_id: string | null
          sale_id: string
          sent_at: string | null
          status: string
          template_id: string
          trigger_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          failed_at?: string | null
          id?: string
          last_error?: string | null
          organization_id: string
          renewal_date: string
          renewal_payment_id?: string | null
          sale_id: string
          sent_at?: string | null
          status?: string
          template_id: string
          trigger_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          failed_at?: string | null
          id?: string
          last_error?: string | null
          organization_id?: string
          renewal_date?: string
          renewal_payment_id?: string | null
          sale_id?: string
          sent_at?: string | null
          status?: string
          template_id?: string
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "renewal_automation_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renewal_automation_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "renewal_automation_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "renewal_automation_runs_renewal_payment_id_fkey"
            columns: ["renewal_payment_id"]
            isOneToOne: false
            referencedRelation: "sale_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renewal_automation_runs_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renewal_automation_runs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_absence_periods: {
        Row: {
          absence_id: string
          business_days: number
          created_at: string
          end_date: string
          end_time: string | null
          id: string
          period_type: string
          start_date: string
          start_time: string | null
          status: string
        }
        Insert: {
          absence_id: string
          business_days?: number
          created_at?: string
          end_date: string
          end_time?: string | null
          id?: string
          period_type?: string
          start_date: string
          start_time?: string | null
          status?: string
        }
        Update: {
          absence_id?: string
          business_days?: number
          created_at?: string
          end_date?: string
          end_time?: string | null
          id?: string
          period_type?: string
          start_date?: string
          start_time?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_absence_periods_absence_id_fkey"
            columns: ["absence_id"]
            isOneToOne: false
            referencedRelation: "rh_absences"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_absences: {
        Row: {
          absence_type: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          end_date: string
          id: string
          notes: string | null
          organization_id: string
          rejection_reason: string | null
          start_date: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          absence_type?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          end_date: string
          id?: string
          notes?: string | null
          organization_id: string
          rejection_reason?: string | null
          start_date: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          absence_type?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          end_date?: string
          id?: string
          notes?: string | null
          organization_id?: string
          rejection_reason?: string | null
          start_date?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_absences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_absences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "rh_absences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      rh_holidays: {
        Row: {
          created_at: string
          date: string
          id: string
          is_national: boolean
          name: string
          organization_id: string
          year: number
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          is_national?: boolean
          name: string
          organization_id: string
          year: number
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          is_national?: boolean
          name?: string
          organization_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "rh_holidays_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_holidays_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "rh_holidays_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      rh_vacation_balances: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          total_days: number
          updated_at: string
          used_days: number
          user_id: string
          year: number
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          total_days?: number
          updated_at?: string
          used_days?: number
          user_id: string
          year: number
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          total_days?: number
          updated_at?: string
          used_days?: number
          user_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "rh_vacation_balances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_vacation_balances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "rh_vacation_balances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      sale_activation_history: {
        Row: {
          activation_date: string
          changed_by: string | null
          created_at: string
          id: string
          notes: string | null
          organization_id: string
          sale_id: string
        }
        Insert: {
          activation_date: string
          changed_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          organization_id: string
          sale_id: string
        }
        Update: {
          activation_date?: string
          changed_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string
          sale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_activation_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_activation_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_activation_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sale_activation_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sale_activation_history_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          created_at: string | null
          discount_percent: number
          first_due_date: string | null
          id: string
          name: string
          price_includes_vat: boolean | null
          product_id: string | null
          quantity: number
          retention_rate: number | null
          sale_id: string
          stripe_price_id: string | null
          tax_exemption_reason: string | null
          tax_value: number | null
          total: number
          unit_price: number
        }
        Insert: {
          created_at?: string | null
          discount_percent?: number
          first_due_date?: string | null
          id?: string
          name: string
          price_includes_vat?: boolean | null
          product_id?: string | null
          quantity?: number
          retention_rate?: number | null
          sale_id: string
          stripe_price_id?: string | null
          tax_exemption_reason?: string | null
          tax_value?: number | null
          total: number
          unit_price: number
        }
        Update: {
          created_at?: string | null
          discount_percent?: number
          first_due_date?: string | null
          id?: string
          name?: string
          price_includes_vat?: boolean | null
          product_id?: string | null
          quantity?: number
          retention_rate?: number | null
          sale_id?: string
          stripe_price_id?: string | null
          tax_exemption_reason?: string | null
          tax_value?: number | null
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_payments: {
        Row: {
          amount: number
          bank_account_id: string | null
          billing_period_end: string | null
          billing_period_start: string | null
          created_at: string | null
          credit_note_id: number | null
          credit_note_reference: string | null
          id: string
          invoice_file_url: string | null
          invoice_reference: string | null
          invoicexpress_id: number | null
          notes: string | null
          organization_id: string
          payment_date: string
          payment_method: string | null
          qr_code_url: string | null
          recurring_cycle_id: string | null
          sale_id: string
          status: string
          stripe_fee_amount: number | null
          stripe_gross_amount: number | null
          stripe_invoice_id: string | null
          stripe_net_amount: number | null
          updated_at: string | null
        }
        Insert: {
          amount: number
          bank_account_id?: string | null
          billing_period_end?: string | null
          billing_period_start?: string | null
          created_at?: string | null
          credit_note_id?: number | null
          credit_note_reference?: string | null
          id?: string
          invoice_file_url?: string | null
          invoice_reference?: string | null
          invoicexpress_id?: number | null
          notes?: string | null
          organization_id: string
          payment_date: string
          payment_method?: string | null
          qr_code_url?: string | null
          recurring_cycle_id?: string | null
          sale_id: string
          status?: string
          stripe_fee_amount?: number | null
          stripe_gross_amount?: number | null
          stripe_invoice_id?: string | null
          stripe_net_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          billing_period_end?: string | null
          billing_period_start?: string | null
          created_at?: string | null
          credit_note_id?: number | null
          credit_note_reference?: string | null
          id?: string
          invoice_file_url?: string | null
          invoice_reference?: string | null
          invoicexpress_id?: number | null
          notes?: string | null
          organization_id?: string
          payment_date?: string
          payment_method?: string | null
          qr_code_url?: string | null
          recurring_cycle_id?: string | null
          sale_id?: string
          status?: string
          stripe_fee_amount?: number | null
          stripe_gross_amount?: number | null
          stripe_invoice_id?: string | null
          stripe_net_amount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_payments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sale_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sale_payments_recurring_cycle_fkey"
            columns: ["recurring_cycle_id", "sale_id", "organization_id"]
            isOneToOne: true
            referencedRelation: "sale_recurring_cycles"
            referencedColumns: ["id", "sale_id", "organization_id"]
          },
          {
            foreignKeyName: "sale_payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_recurring_cycles: {
        Row: {
          amount: number
          created_at: string
          currency: string
          due_date: string
          failure_reason: string | null
          id: string
          organization_id: string
          paid_at: string | null
          period_end: string
          period_start: string
          recurrence_id: string
          sale_id: string
          status: string
          stripe_invoice_id: string | null
          stripe_invoice_status: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          due_date: string
          failure_reason?: string | null
          id?: string
          organization_id: string
          paid_at?: string | null
          period_end: string
          period_start: string
          recurrence_id: string
          sale_id: string
          status?: string
          stripe_invoice_id?: string | null
          stripe_invoice_status?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          due_date?: string
          failure_reason?: string | null
          id?: string
          organization_id?: string
          paid_at?: string | null
          period_end?: string
          period_start?: string
          recurrence_id?: string
          sale_id?: string
          status?: string
          stripe_invoice_id?: string | null
          stripe_invoice_status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_recurring_cycles_recurrence_fkey"
            columns: ["recurrence_id", "sale_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "sale_recurrences"
            referencedColumns: ["id", "sale_id", "organization_id"]
          },
          {
            foreignKeyName: "sale_recurring_cycles_sale_fkey"
            columns: ["sale_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      sale_recurrences: {
        Row: {
          amount: number
          anchor_date: string
          billing_provider: string
          billing_status: string
          cancelled_at: string | null
          created_at: string
          currency: string
          id: string
          inactive_at: string | null
          interval: string
          interval_count: number
          last_cycle_date: string | null
          next_cycle_date: string | null
          organization_id: string
          paused_at: string | null
          sale_id: string
          service_status: string
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          anchor_date: string
          billing_provider?: string
          billing_status?: string
          cancelled_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          inactive_at?: string | null
          interval?: string
          interval_count?: number
          last_cycle_date?: string | null
          next_cycle_date?: string | null
          organization_id: string
          paused_at?: string | null
          sale_id: string
          service_status?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          anchor_date?: string
          billing_provider?: string
          billing_status?: string
          cancelled_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          inactive_at?: string | null
          interval?: string
          interval_count?: number
          last_cycle_date?: string | null
          next_cycle_date?: string | null
          organization_id?: string
          paused_at?: string | null
          sale_id?: string
          service_status?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_recurrences_sale_fkey"
            columns: ["sale_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      sales: {
        Row: {
          activation_date: string | null
          anos_contrato: number | null
          approved_at: string | null
          approved_by: string | null
          billing_target: string | null
          client_id: string | null
          client_org_id: string | null
          code: string | null
          comissao: number | null
          commission_bank_account_id: string | null
          commission_paid_at: string | null
          consumo_anual: number | null
          created_at: string | null
          created_by: string | null
          credit_note_id: number | null
          credit_note_reference: string | null
          dbl: number | null
          discount: number | null
          due_date: string | null
          edp_proposal_number: string | null
          has_recurring: boolean | null
          gross_value: number | null
          id: string
          invoice_pdf_url: string | null
          invoice_reference: string | null
          invoicexpress_id: number | null
          invoicexpress_type: string | null
          kwp: number | null
          last_renewal_date: string | null
          lead_id: string | null
          margem: number | null
          meta_capi_purchase_sent_at: string | null
          modelo_servico: string | null
          negotiation_type: string | null
          next_renewal_date: string | null
          notes: string | null
          organization_id: string
          operational_units: number
          paid_date: string | null
          payment_method: string | null
          payment_status: string | null
          proposal_id: string | null
          proposal_type: string | null
          qr_code_url: string | null
          recurring_status: string | null
          recurring_value: number | null
          sale_date: string | null
          servicos_details: Json | null
          servicos_produtos: string[] | null
          status: string
          subtotal: number | null
          total_value: number
          updated_at: string | null
        }
        Insert: {
          activation_date?: string | null
          anos_contrato?: number | null
          approved_at?: string | null
          approved_by?: string | null
          billing_target?: string | null
          client_id?: string | null
          client_org_id?: string | null
          code?: string | null
          comissao?: number | null
          commission_bank_account_id?: string | null
          commission_paid_at?: string | null
          consumo_anual?: number | null
          created_at?: string | null
          created_by?: string | null
          credit_note_id?: number | null
          credit_note_reference?: string | null
          dbl?: number | null
          discount?: number | null
          due_date?: string | null
          edp_proposal_number?: string | null
          has_recurring?: boolean | null
          gross_value?: number | null
          id?: string
          invoice_pdf_url?: string | null
          invoice_reference?: string | null
          invoicexpress_id?: number | null
          invoicexpress_type?: string | null
          kwp?: number | null
          last_renewal_date?: string | null
          lead_id?: string | null
          margem?: number | null
          meta_capi_purchase_sent_at?: string | null
          modelo_servico?: string | null
          negotiation_type?: string | null
          next_renewal_date?: string | null
          notes?: string | null
          organization_id: string
          operational_units?: number
          paid_date?: string | null
          payment_method?: string | null
          payment_status?: string | null
          proposal_id?: string | null
          proposal_type?: string | null
          qr_code_url?: string | null
          recurring_status?: string | null
          recurring_value?: number | null
          sale_date?: string | null
          servicos_details?: Json | null
          servicos_produtos?: string[] | null
          status?: string
          subtotal?: number | null
          total_value?: number
          updated_at?: string | null
        }
        Update: {
          activation_date?: string | null
          anos_contrato?: number | null
          approved_at?: string | null
          approved_by?: string | null
          billing_target?: string | null
          client_id?: string | null
          client_org_id?: string | null
          code?: string | null
          comissao?: number | null
          commission_bank_account_id?: string | null
          commission_paid_at?: string | null
          consumo_anual?: number | null
          created_at?: string | null
          created_by?: string | null
          credit_note_id?: number | null
          credit_note_reference?: string | null
          dbl?: number | null
          discount?: number | null
          due_date?: string | null
          edp_proposal_number?: string | null
          has_recurring?: boolean | null
          gross_value?: number | null
          id?: string
          invoice_pdf_url?: string | null
          invoice_reference?: string | null
          invoicexpress_id?: number | null
          invoicexpress_type?: string | null
          kwp?: number | null
          last_renewal_date?: string | null
          lead_id?: string | null
          margem?: number | null
          meta_capi_purchase_sent_at?: string | null
          modelo_servico?: string | null
          negotiation_type?: string | null
          next_renewal_date?: string | null
          notes?: string | null
          organization_id?: string
          operational_units?: number
          paid_date?: string | null
          payment_method?: string | null
          payment_status?: string | null
          proposal_id?: string | null
          proposal_type?: string | null
          qr_code_url?: string | null
          recurring_status?: string | null
          recurring_value?: number | null
          sale_date?: string | null
          servicos_details?: Json | null
          servicos_produtos?: string[] | null
          status?: string
          subtotal?: number | null
          total_value?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "crm_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_client_org_id_fkey"
            columns: ["client_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_client_org_id_fkey"
            columns: ["client_org_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sales_client_org_id_fkey"
            columns: ["client_org_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sales_commission_bank_account_id_fkey"
            columns: ["commission_bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sales_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "sales_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_messages: {
        Row: {
          content: string
          created_at: string | null
          created_by: string
          error: string | null
          id: string
          organization_id: string
          phone: string
          phone_key: string | null
          send_at: string
          sent_at: string | null
          status: string
        }
        Insert: {
          content: string
          created_at?: string | null
          created_by: string
          error?: string | null
          id?: string
          organization_id: string
          phone: string
          phone_key?: string | null
          send_at: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          content?: string
          created_at?: string | null
          created_by?: string
          error?: string | null
          id?: string
          organization_id?: string
          phone?: string
          phone_key?: string | null
          send_at?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "scheduled_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      shipments: {
        Row: {
          carrier: string | null
          created_at: string | null
          delivered_at: string | null
          id: string
          notes: string | null
          order_id: string
          organization_id: string
          shipped_at: string | null
          status: string | null
          tracking_number: string | null
          tracking_url: string | null
          updated_at: string | null
        }
        Insert: {
          carrier?: string | null
          created_at?: string | null
          delivered_at?: string | null
          id?: string
          notes?: string | null
          order_id: string
          organization_id: string
          shipped_at?: string | null
          status?: string | null
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string | null
        }
        Update: {
          carrier?: string | null
          created_at?: string | null
          delivered_at?: string | null
          id?: string
          notes?: string | null
          order_id?: string
          organization_id?: string
          shipped_at?: string | null
          status?: string | null
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "shipments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      stripe_commission_records: {
        Row: {
          amount: number
          bank_account_id: string | null
          client_org_id: string
          commission_amount: number
          commission_rate: number
          created_at: string
          id: string
          organization_id: string
          paid_at: string | null
          period_end: string | null
          period_start: string | null
          plan: string | null
          sale_id: string
          status: string
          stripe_invoice_id: string | null
          user_id: string
        }
        Insert: {
          amount?: number
          bank_account_id?: string | null
          client_org_id: string
          commission_amount?: number
          commission_rate?: number
          created_at?: string
          id?: string
          organization_id: string
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          plan?: string | null
          sale_id: string
          status?: string
          stripe_invoice_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          client_org_id?: string
          commission_amount?: number
          commission_rate?: number
          created_at?: string
          id?: string
          organization_id?: string
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          plan?: string | null
          sale_id?: string
          status?: string
          stripe_invoice_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_commission_records_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stripe_commission_records_client_org_id_fkey"
            columns: ["client_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stripe_commission_records_client_org_id_fkey"
            columns: ["client_org_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "stripe_commission_records_client_org_id_fkey"
            columns: ["client_org_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "stripe_commission_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stripe_commission_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "stripe_commission_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "stripe_commission_records_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_connections: {
        Row: {
          charges_enabled: boolean
          connected_at: string
          created_at: string
          details_submitted: boolean
          disconnected_at: string | null
          id: string
          last_error: string | null
          mode: string
          organization_id: string
          status: string
          stripe_account_id: string
          updated_at: string
        }
        Insert: {
          charges_enabled?: boolean
          connected_at?: string
          created_at?: string
          details_submitted?: boolean
          disconnected_at?: string | null
          id?: string
          last_error?: string | null
          mode: string
          organization_id: string
          status?: string
          stripe_account_id: string
          updated_at?: string
        }
        Update: {
          charges_enabled?: boolean
          connected_at?: string
          created_at?: string
          details_submitted?: boolean
          disconnected_at?: string | null
          id?: string
          last_error?: string | null
          mode?: string
          organization_id?: string
          status?: string
          stripe_account_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stripe_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "stripe_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      stripe_events: {
        Row: {
          attempts: number
          event_type: string
          id: string
          last_error: string | null
          livemode: boolean
          organization_id: string
          processed_at: string | null
          received_at: string
          status: string
          stripe_account_id: string
          stripe_event_id: string
        }
        Insert: {
          attempts?: number
          event_type: string
          id?: string
          last_error?: string | null
          livemode: boolean
          organization_id: string
          processed_at?: string | null
          received_at?: string
          status?: string
          stripe_account_id: string
          stripe_event_id: string
        }
        Update: {
          attempts?: number
          event_type?: string
          id?: string
          last_error?: string | null
          livemode?: boolean
          organization_id?: string
          processed_at?: string | null
          received_at?: string
          status?: string
          stripe_account_id?: string
          stripe_event_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_events_connection_fkey"
            columns: ["stripe_account_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stripe_connections"
            referencedColumns: ["stripe_account_id", "organization_id"]
          },
        ]
      }
      stripe_product_mappings: {
        Row: {
          active: boolean
          created_at: string
          currency: string
          id: string
          interval: string
          interval_count: number
          organization_id: string
          product_id: string
          stripe_connection_id: string
          stripe_price_id: string
          stripe_product_id: string
          sync_error: string | null
          synced_at: string | null
          unit_amount: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          currency?: string
          id?: string
          interval?: string
          interval_count?: number
          organization_id: string
          product_id: string
          stripe_connection_id: string
          stripe_price_id: string
          stripe_product_id: string
          sync_error?: string | null
          synced_at?: string | null
          unit_amount: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          currency?: string
          id?: string
          interval?: string
          interval_count?: number
          organization_id?: string
          product_id?: string
          stripe_connection_id?: string
          stripe_price_id?: string
          stripe_product_id?: string
          sync_error?: string | null
          synced_at?: string | null
          unit_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_product_mappings_connection_fkey"
            columns: ["stripe_connection_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stripe_connections"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stripe_product_mappings_product_fkey"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          created_at: string
          features: Json
          id: string
          max_forms: number | null
          max_inboxes: number | null
          max_users: number | null
          name: string
          price_monthly: number
        }
        Insert: {
          created_at?: string
          features?: Json
          id: string
          max_forms?: number | null
          max_inboxes?: number | null
          max_users?: number | null
          name: string
          price_monthly?: number
        }
        Update: {
          created_at?: string
          features?: Json
          id?: string
          max_forms?: number | null
          max_inboxes?: number | null
          max_users?: number | null
          name?: string
          price_monthly?: number
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          attachments: Json | null
          created_at: string
          description: string
          id: string
          organization_id: string
          priority: string
          status: string
          subject: string
          ticket_code: string | null
          user_id: string
        }
        Insert: {
          attachments?: Json | null
          created_at?: string
          description: string
          id?: string
          organization_id: string
          priority?: string
          status?: string
          subject: string
          ticket_code?: string | null
          user_id: string
        }
        Update: {
          attachments?: Json | null
          created_at?: string
          description?: string
          id?: string
          organization_id?: string
          priority?: string
          status?: string
          subject?: string
          ticket_code?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "support_tickets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string
          id: string
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          id: string
          leader_id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          leader_id: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          leader_id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "teams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      trial_whatsapp_config: {
        Row: {
          cooldown_days: number
          enabled: boolean
          max_count: number
          messages: Json
          organization_id: string
          threshold_days: number
          updated_at: string
        }
        Insert: {
          cooldown_days?: number
          enabled?: boolean
          max_count?: number
          messages?: Json
          organization_id: string
          threshold_days?: number
          updated_at?: string
        }
        Update: {
          cooldown_days?: number
          enabled?: boolean
          max_count?: number
          messages?: Json
          organization_id?: string
          threshold_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trial_whatsapp_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trial_whatsapp_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "trial_activation_counts"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "trial_whatsapp_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "trial_activation_overview"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      stripe_connection_summaries: {
        Row: {
          charges_enabled: boolean | null
          connected_at: string | null
          details_submitted: boolean | null
          disconnected_at: string | null
          id: string | null
          masked_account_id: string | null
          mode: string | null
          organization_id: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          charges_enabled?: boolean | null
          connected_at?: string | null
          details_submitted?: boolean | null
          disconnected_at?: string | null
          id?: string | null
          masked_account_id?: never
          mode?: string | null
          organization_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          charges_enabled?: boolean | null
          connected_at?: string | null
          details_submitted?: boolean | null
          disconnected_at?: string | null
          id?: string | null
          masked_account_id?: never
          mode?: string | null
          organization_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      trial_activation_counts: {
        Row: {
          days_since_registration: number | null
          last_active_at: string | null
          name: string | null
          onboarding_module_count: number | null
          organization_id: string | null
          total_clients: number | null
          total_leads: number | null
          total_proposals: number | null
          total_sales: number | null
          trial_reminders_sent: number | null
        }
        Relationships: []
      }
      trial_activation_overview: {
        Row: {
          activated_adv: boolean | null
          activated_med: boolean | null
          activated_min: boolean | null
          activation_level: string | null
          created_at: string | null
          current_period_end: string | null
          first_client_at: string | null
          first_lead_at: string | null
          first_paid_at: string | null
          first_proposal_at: string | null
          first_sale_at: string | null
          hours_since_active: number | null
          is_paying: boolean | null
          last_active_at: string | null
          name: string | null
          organization_id: string | null
          plan: string | null
          trial_days_left: number | null
          trial_ends_at: string | null
          trial_status: string | null
        }
        Insert: {
          activated_adv?: never
          activated_med?: never
          activated_min?: never
          activation_level?: never
          created_at?: string | null
          current_period_end?: string | null
          first_client_at?: string | null
          first_lead_at?: string | null
          first_paid_at?: string | null
          first_proposal_at?: string | null
          first_sale_at?: string | null
          hours_since_active?: never
          is_paying?: never
          last_active_at?: string | null
          name?: string | null
          organization_id?: string | null
          plan?: string | null
          trial_days_left?: never
          trial_ends_at?: string | null
          trial_status?: never
        }
        Update: {
          activated_adv?: never
          activated_med?: never
          activated_min?: never
          activation_level?: never
          created_at?: string | null
          current_period_end?: string | null
          first_client_at?: string | null
          first_lead_at?: string | null
          first_paid_at?: string | null
          first_proposal_at?: string | null
          first_sale_at?: string | null
          hours_since_active?: never
          is_paying?: never
          last_active_at?: string | null
          name?: string | null
          organization_id?: string | null
          plan?: string | null
          trial_days_left?: never
          trial_ends_at?: string | null
          trial_status?: never
        }
        Relationships: []
      }
    }
    Functions: {
      meets_mfa_policy: {
        Args: { _user_id: string }
        Returns: boolean
      }
      accept_invite: {
        Args: { _token: string; _user_id: string }
        Returns: boolean
      }
      acquire_renewal_automation_run: {
        Args: {
          p_organization_id: string
          p_renewal_date: string
          p_renewal_payment_id?: string
          p_sale_id: string
          p_template_id: string
          p_trigger_type: string
        }
        Returns: string
      }
      admin_org_last_sign_in: {
        Args: never
        Returns: {
          last_login: string
          org_id: string
        }[]
      }
      automation_internal_secret: { Args: never; Returns: string }
      automation_phone_key: { Args: { p_phone: string }; Returns: string }
      bump_channel_flap: {
        Args: {
          p_channel_id: string
          p_threshold: number
          p_window_seconds: number
        }
        Returns: boolean
      }
      calc_bank_running_balance: {
        Args: { _bank_account_id: string; _transaction_date: string }
        Returns: number
      }
      compute_sale_commission: { Args: { p_sale_id: string }; Returns: number }
      create_organization_for_current_user:
        | { Args: { _name: string; _slug: string }; Returns: string }
        | {
            Args: { _contact_phone?: string; _name: string; _slug: string }
            Returns: string
          }
      create_recurring_cycle: {
        Args: { p_period_start: string; p_recurrence_id: string }
        Returns: Database["public"]["Tables"]["sale_recurring_cycles"]["Row"]
      }
      distribute_prospects_round_robin:
        | {
            Args: {
              p_organization_id: string
              p_prospect_ids: string[]
              p_quantity: number
              p_salesperson_ids?: string[]
            }
            Returns: {
              created_leads_count: number
              distributed_count: number
            }[]
          }
        | {
            Args: {
              p_organization_id: string
              p_prospect_ids: string[]
              p_salesperson_ids?: string[]
            }
            Returns: {
              created_leads_count: number
              distributed_count: number
            }[]
          }
        | {
            Args: {
              p_organization_id: string
              p_quantity: number
              p_salesperson_ids?: string[]
            }
            Returns: {
              created_leads_count: number
              distributed_count: number
            }[]
          }
      enqueue_trial_whatsapp_nudges: { Args: never; Returns: number }
      ensure_newsletter_removed_list: {
        Args: { p_org_id: string }
        Returns: string
      }
      ensure_org_auto_lists: { Args: { p_org_id: string }; Returns: undefined }
      ensure_stripe_auto_lists: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      generate_client_code: { Args: { _org_id: string }; Returns: string }
      generate_order_number: { Args: { _org_id: string }; Returns: string }
      generate_product_code: { Args: { _org_id: string }; Returns: string }
      generate_proposal_code: { Args: { _org_id: string }; Returns: string }
      generate_sale_code: { Args: { _org_id: string }; Returns: string }
      get_all_organizations: {
        Args: never
        Returns: {
          member_count: number
          organization_code: string
          organization_id: string
          organization_name: string
          organization_slug: string
        }[]
      }
      get_form_by_slugs: {
        Args: { _form_slug?: string; _org_slug: string }
        Returns: {
          form_id: string
          form_name: string
          form_settings: Json
          meta_pixels: Json
          org_id: string
          org_name: string
          org_slug: string
          public_key: string
        }[]
      }
      get_next_channel_assignee: {
        Args: { p_channel_id: string }
        Returns: string
      }
      get_next_form_assignee: { Args: { p_form_id: string }; Returns: string }
      get_next_round_robin_assignee: {
        Args: { p_exclude_admins?: boolean; p_org_id: string }
        Returns: string
      }
      get_next_webhook_assignee: {
        Args: { p_webhook_id: string }
        Returns: string
      }
      get_org_by_public_key: { Args: { _public_key: string }; Returns: string }
      get_org_name_by_invite_token: {
        Args: { _token: string }
        Returns: string
      }
      get_org_public_by_slug: {
        Args: { _slug: string }
        Returns: {
          id: string
          name: string
          slug: string
        }[]
      }
      get_org_public_data: {
        Args: { _org_id: string }
        Returns: {
          ai_qualification_rules: string
          ai_response_mode: string
          code: string
          created_at: string
          enabled_modules: Json
          form_settings: Json
          id: string
          integrations_enabled: Json
          logo_url: string
          msg_template_cold: string
          msg_template_hot: string
          msg_template_warm: string
          name: string
          niche: string
          plan: string
          public_key: string
          sales_settings: Json
          servicos_products_config: Json
          slug: string
          tax_config: Json
        }[]
      }
      get_org_salespeople: {
        Args: { p_org_id: string }
        Returns: {
          full_name: string
          user_id: string
        }[]
      }
      get_public_form_by_key: {
        Args: { _public_key: string }
        Returns: {
          form_settings: Json
          id: string
          name: string
        }[]
      }
      get_public_form_by_slug: {
        Args: { _slug: string }
        Returns: {
          form_settings: Json
          id: string
          meta_pixels: Json
          name: string
          public_key: string
        }[]
      }
      get_slug_by_public_key: { Args: { _public_key: string }; Returns: string }
      get_subscription_plan: {
        Args: { _plan_id: string }
        Returns: {
          created_at: string
          features: Json
          id: string
          max_forms: number | null
          max_inboxes: number | null
          max_users: number | null
          name: string
          price_monthly: number
        }[]
        SetofOptions: {
          from: "*"
          to: "subscription_plans"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_team_member_ids: { Args: { p_user_id: string }; Returns: string[] }
      get_user_org_id: { Args: { _user_id: string }; Returns: string }
      get_user_organizations: {
        Args: { _user_id: string }
        Returns: {
          is_active: boolean
          member_role: Database["public"]["Enums"]["app_role"]
          organization_code: string
          organization_id: string
          organization_name: string
          organization_slug: string
        }[]
      }
      handle_email_unsubscribe: {
        Args: { p_token: string }
        Returns: {
          message: string
          success: boolean
        }[]
      }
      has_finance_approve_permission: {
        Args: { _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      immutable_unaccent: { Args: { "": string }; Returns: string }
      import_commission_chargebacks:
        | {
            Args: {
              p_cpe_column_name: string
              p_file_name: string
              p_organization_id: string
              p_rows: Json
            }
            Returns: {
              chargeback_count: number
              import_id: string
              matched_rows: number
              total_chargeback_amount: number
              total_rows: number
              unmatched_rows: number
            }[]
          }
        | {
            Args: {
              p_cpe_column_name: string
              p_file_name: string
              p_organization_id: string
              p_reference_month?: string
              p_rows: Json
            }
            Returns: {
              chargeback_count: number
              import_id: string
              matched_rows: number
              total_chargeback_amount: number
              total_rows: number
              unmatched_rows: number
            }[]
          }
      import_leads_bulk: { Args: { p_leads: Json }; Returns: Json }
      increment_meta_unread: {
        Args: { _conversation_id: string }
        Returns: undefined
      }
      internal_service_key: { Args: never; Returns: string }
      is_org_admin: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_member: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      is_slug_available: { Args: { _slug: string }; Returns: boolean }
      mark_meta_read: {
        Args: { _conversation_id: string; _seen: number }
        Returns: undefined
      }
      mark_renewal_automation_run: {
        Args: { p_last_error?: string; p_run_id: string; p_status: string }
        Returns: undefined
      }
      merge_messaging_channel_metadata: {
        Args: { p_channel_type: string; p_org_id: string; p_patch: Json }
        Returns: undefined
      }
      merge_messaging_channel_metadata_by_id: {
        Args: { p_channel_id: string; p_patch: Json }
        Returns: undefined
      }
      normalize_chargeback_cpe: { Args: { p_cpe: string }; Returns: string }
      org_max_users:
        | {
            Args: { o: Database["public"]["Tables"]["organizations"]["Row"] }
            Returns: number
          }
        | { Args: { p_org_id: string }; Returns: number }
      org_plan_base_users:
        | {
            Args: { o: Database["public"]["Tables"]["organizations"]["Row"] }
            Returns: number
          }
        | { Args: { p_plan: string }; Returns: number }
      org_required_extra_seats:
        | {
            Args: { o: Database["public"]["Tables"]["organizations"]["Row"] }
            Returns: number
          }
        | { Args: { p_org_id: string }; Returns: number }
      parse_chargeback_amount: { Args: { p_value: string }; Returns: number }
      pode_aceder_caixa: {
        Args: { _channel_id: string; _user_id: string }
        Returns: boolean
      }
      recent_signup_exists: { Args: { _phone: string }; Returns: boolean }
      search_clients_unaccent: {
        Args: { max_results?: number; org_id: string; search_term: string }
        Returns: {
          address_line1: string | null
          address_line2: string | null
          assigned_to: string | null
          billing_target: string
          city: string | null
          code: string | null
          company: string | null
          company_nif: string | null
          conselho: string | null
          country: string | null
          created_at: string | null
          distrito: string | null
          email: string | null
          grupo_economico: string | null
          id: string
          lead_id: string | null
          name: string
          nif: string | null
          notes: string | null
          organization_id: string
          phone: string | null
          postal_code: string | null
          source: string | null
          status: string | null
          total_comissao: number | null
          total_kwp: number | null
          total_mwh: number | null
          total_proposals: number | null
          total_sales: number | null
          total_value: number | null
          updated_at: string | null
          whatsapp: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "crm_clients"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_credit_notes_unaccent: {
        Args: {
          cn_status?: string
          max_results?: number
          org_id: string
          search_term: string
        }
        Returns: {
          client_name: string | null
          created_at: string | null
          date: string | null
          id: string
          invoicexpress_id: number
          organization_id: string
          payment_id: string | null
          pdf_path: string | null
          raw_data: Json | null
          reference: string | null
          related_invoice_id: number | null
          sale_id: string | null
          status: string | null
          total: number | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "credit_notes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_invoices_unaccent: {
        Args: {
          inv_status?: string
          max_results?: number
          org_id: string
          search_term: string
        }
        Returns: {
          client_name: string | null
          created_at: string | null
          date: string | null
          document_type: string | null
          due_date: string | null
          id: string
          invoicexpress_id: number
          organization_id: string
          payment_id: string | null
          pdf_path: string | null
          raw_data: Json | null
          reference: string | null
          sale_id: string | null
          status: string | null
          total: number | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_leads_unaccent: {
        Args: {
          lead_status?: string
          max_results?: number
          org_id: string
          search_term: string
        }
        Returns: {
          archived_at: string | null
          assigned_to: string | null
          automation_enabled: boolean
          company_name: string | null
          company_nif: string | null
          consumo_anual: number | null
          created_at: string | null
          custom_data: Json | null
          email: string
          form_id: string | null
          gdpr_consent: boolean
          id: string
          import_id: string | null
          name: string
          notes: string | null
          organization_id: string
          phone: string
          source: string | null
          status: string | null
          temperature: string | null
          tipologia: string | null
          updated_at: string | null
          value: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "leads"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_organizations_by_name: {
        Args: { _caller_org_id: string; _limit?: number; _search: string }
        Returns: {
          id: string
          name: string
          slug: string
        }[]
      }
      search_proposals_unaccent: {
        Args: {
          max_results?: number
          org_id: string
          prop_status?: string
          search_term: string
        }
        Returns: {
          accepted_at: string | null
          anos_contrato: number | null
          client_id: string | null
          code: string | null
          comissao: number | null
          consumo_anual: number | null
          created_at: string | null
          created_by: string | null
          dbl: number | null
          id: string
          kwp: number | null
          lead_id: string | null
          margem: number | null
          modelo_servico: string | null
          negotiation_type: string | null
          notes: string | null
          organization_id: string
          proposal_date: string | null
          proposal_type: string | null
          servicos_details: Json | null
          servicos_produtos: string[] | null
          status: string
          total_value: number
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "proposals"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_sales_unaccent: {
        Args: {
          max_results?: number
          org_id: string
          pay_status?: string
          search_term: string
        }
        Returns: {
          activation_date: string | null
          anos_contrato: number | null
          approved_at: string | null
          approved_by: string | null
          client_id: string | null
          client_org_id: string | null
          code: string | null
          comissao: number | null
          commission_bank_account_id: string | null
          commission_paid_at: string | null
          consumo_anual: number | null
          created_at: string | null
          created_by: string | null
          credit_note_id: number | null
          credit_note_reference: string | null
          dbl: number | null
          discount: number | null
          due_date: string | null
          edp_proposal_number: string | null
          has_recurring: boolean | null
          id: string
          invoice_pdf_url: string | null
          invoice_reference: string | null
          invoicexpress_id: number | null
          invoicexpress_type: string | null
          kwp: number | null
          last_renewal_date: string | null
          lead_id: string | null
          margem: number | null
          meta_capi_purchase_sent_at: string | null
          modelo_servico: string | null
          negotiation_type: string | null
          next_renewal_date: string | null
          notes: string | null
          organization_id: string
          paid_date: string | null
          payment_method: string | null
          payment_status: string | null
          proposal_id: string | null
          proposal_type: string | null
          qr_code_url: string | null
          recurring_status: string | null
          recurring_value: number | null
          sale_date: string | null
          servicos_details: Json | null
          servicos_produtos: string[] | null
          status: string
          subtotal: number | null
          total_value: number
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "sales"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      transition_sale_recurrence: {
        Args: { p_action: string; p_recurrence_id: string }
        Returns: Database["public"]["Tables"]["sale_recurrences"]["Row"]
      }
      unaccent: { Args: { "": string }; Returns: string }
      verify_automation_secret: { Args: { p_secret: string }; Returns: boolean }
      verify_stripe_cron_secret: {
        Args: { p_secret: string }
        Returns: boolean
      }
      verify_user_org_membership: {
        Args: { p_email: string; p_org_slug: string }
        Returns: {
          is_member: boolean
          organization_id: string
          organization_name: string
          user_id: string
        }[]
      }
    }
    Enums: {
      app_role: "super_admin" | "admin" | "viewer" | "salesperson"
      rh_absence_status:
        | "pending"
        | "approved"
        | "partially_approved"
        | "rejected"
      rh_absence_type:
        | "vacation"
        | "sick_leave"
        | "appointment"
        | "personal_leave"
        | "training"
        | "other"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["super_admin", "admin", "viewer", "salesperson"],
      rh_absence_status: [
        "pending",
        "approved",
        "partially_approved",
        "rejected",
      ],
      rh_absence_type: [
        "vacation",
        "sick_leave",
        "appointment",
        "personal_leave",
        "training",
        "other",
      ],
    },
  },
} as const
