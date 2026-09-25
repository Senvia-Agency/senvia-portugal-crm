import { useEffect, useRef, useCallback, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import { Separator } from "@/components/ui/separator";
import { TEMPLATE_VARIABLES_CLIENT, TEMPLATE_VARIABLES_ORG, TEMPLATE_VARIABLES_RENEWAL } from "@/types/marketing";
import { cn } from "@/lib/utils";
import {
  Bold,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Undo,
  Redo,
  Unlink,
  AlertTriangle,
} from "lucide-react";

interface TemplateEditorProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

const COMPLEX_HTML_REGEX = /<(table|div|img|style|section|header|footer|td|tr|th|thead|tbody|span[^>]*style)/i;

function hasComplexHtml(html: string): boolean {
  return COMPLEX_HTML_REGEX.test(html);
}

function EditorToolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;

  const setLink = useCallback(() => {
    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt("URL do link:", previousUrl);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  return (
    <div className="flex flex-wrap items-center gap-1 p-2 border-b bg-muted/30">
      <Toggle size="sm" pressed={editor.isActive("bold")} onPressedChange={() => editor.chain().focus().toggleBold().run()} aria-label="Negrito">
        <Bold className="h-4 w-4" />
      </Toggle>
      <Toggle size="sm" pressed={editor.isActive("italic")} onPressedChange={() => editor.chain().focus().toggleItalic().run()} aria-label="Itálico">
        <Italic className="h-4 w-4" />
      </Toggle>
      <Separator orientation="vertical" className="h-6 mx-1" />
      <Toggle size="sm" pressed={editor.isActive("heading", { level: 1 })} onPressedChange={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} aria-label="Título 1">
        <Heading1 className="h-4 w-4" />
      </Toggle>
      <Toggle size="sm" pressed={editor.isActive("heading", { level: 2 })} onPressedChange={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} aria-label="Título 2">
        <Heading2 className="h-4 w-4" />
      </Toggle>
      <Separator orientation="vertical" className="h-6 mx-1" />
      <Toggle size="sm" pressed={editor.isActive("bulletList")} onPressedChange={() => editor.chain().focus().toggleBulletList().run()} aria-label="Lista">
        <List className="h-4 w-4" />
      </Toggle>
      <Toggle size="sm" pressed={editor.isActive("orderedList")} onPressedChange={() => editor.chain().focus().toggleOrderedList().run()} aria-label="Lista numerada">
        <ListOrdered className="h-4 w-4" />
      </Toggle>
      <Separator orientation="vertical" className="h-6 mx-1" />
      <Toggle size="sm" pressed={editor.isActive("link")} onPressedChange={setLink} aria-label="Inserir link">
        <LinkIcon className="h-4 w-4" />
      </Toggle>
      {editor.isActive("link") && (
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => editor.chain().focus().unsetLink().run()} aria-label="Remover link">
          <Unlink className="h-4 w-4" />
        </Button>
      )}
      <Separator orientation="vertical" className="h-6 mx-1" />
      <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} aria-label="Desfazer">
        <Undo className="h-4 w-4" />
      </Button>
      <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} aria-label="Refazer">
        <Redo className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function TemplateEditor({ value, onChange, className }: TemplateEditorProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const htmlTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [activeTab, setActiveTab] = useState("editor");
  // Track whether TipTap content is stale (edited via HTML tab)
  const tiptapSyncedRef = useRef(true);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2] } }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-primary underline" } }),
      Placeholder.configure({ placeholder: "Escreva o conteúdo do seu email aqui..." }),
    ],
    content: value,
    onUpdate: ({ editor }) => {
      if (activeTab === "editor") {
        tiptapSyncedRef.current = true;
        onChange(editor.getHTML());
      }
    },
    editorProps: {
      attributes: {
        class: "prose prose-sm dark:prose-invert max-w-none min-h-[250px] p-4 focus:outline-none",
      },
    },
  });

  // NO auto-sync useEffect — this was the destructive bug.
  // Instead, sync only on tab change via handleTabChange.

  // Update preview iframe whenever value changes
  useEffect(() => {
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        const previewContent = value || '<p style="color: #999;">O preview aparecerá aqui...</p>';
        const previewBody = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(previewContent)?.[1] || previewContent;
        const previewStyles = [...(previewContent.matchAll(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi))]
          .map((match) => match[0])
          .join("\n");
        doc.write(`
          <!DOCTYPE html>
          <html lang="pt-PT">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              ${previewStyles}
              <style>
                body {
                  font-family: Arial, sans-serif;
                  font-size: 16px;
                  line-height: 1.6;
                  color: #334155;
                  padding: 0;
                  margin: 0;
                  background: #F0F4F8;
                }
                a { color: #3B82F6; }
                img { max-width: 100%; height: auto; }
                h1 { font-size: 1.5em; margin: 0.5em 0; }
                h2 { font-size: 1.25em; margin: 0.5em 0; }
                p { margin: 0.5em 0; }
                ul, ol { margin: 0.5em 0; padding-left: 1.5em; }
                table { border-collapse: collapse; width: 100%; }
                td, th { padding: 8px; }
              </style>
            </head>
            <body style="margin:0;padding:0;background-color:#F0F4F8;font-family:Arial,sans-serif">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F0F4F8;padding:32px 0">
                <tr><td align="center">
                  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 4px 10px rgba(0,0,0,.1)">
                    <tr><td align="center" style="background-color:#1E3A8A;background-image:linear-gradient(135deg,#1E3A8A 0%,#2563EB 100%);padding:32px">
                      <img src="https://app.senvia.pt/senvia-logo-white.png" alt="SENVIA" width="150" style="display:block;width:150px;max-width:100%;height:auto;margin:0 auto">
                    </td></tr>
                    <tr><td style="padding:32px 40px;color:#334155;font-family:Arial,sans-serif;font-size:16px;line-height:1.6">${previewBody}</td></tr>
                    <tr><td align="center" style="background:#F8FAFC;padding:18px;border-top:1px solid #E2E8F0;color:#64748B;font-size:14px;font-weight:bold">Transforme tráfego em lucro.</td></tr>
                  </table>
                </td></tr>
              </table>
            </body>
          </html>
        `);
        doc.close();
      }
    }
  }, [value]);

  const handleTabChange = (newTab: string) => {
    if (newTab === "editor" && !tiptapSyncedRef.current && editor) {
      // Sync TipTap with current value (may simplify complex HTML)
      editor.commands.setContent(value);
      tiptapSyncedRef.current = true;
    }
    if (newTab === "html" && editor) {
      // Mark TipTap as potentially stale from now on
      tiptapSyncedRef.current = false;
    }
    setActiveTab(newTab);
  };

  const insertVariable = (variable: string) => {
    if (activeTab === "editor" && editor) {
      editor.chain().focus().insertContent(variable).run();
    } else if (activeTab === "html" && htmlTextareaRef.current) {
      const textarea = htmlTextareaRef.current;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = value.substring(0, start) + variable + value.substring(end);
      onChange(newValue);
      requestAnimationFrame(() => {
        textarea.focus();
        const newPos = start + variable.length;
        textarea.setSelectionRange(newPos, newPos);
      });
    }
  };

  const showComplexWarning = activeTab === "editor" && hasComplexHtml(value);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Variables */}
      <div className="space-y-3">
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Contacto / Cliente</Label>
          <div className="flex flex-wrap gap-2">
            {TEMPLATE_VARIABLES_CLIENT.map((v) => (
              <Button key={v.key} type="button" variant="outline" size="sm" className="h-7 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => insertVariable(v.key)}>
                {v.key}
              </Button>
            ))}
          </div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Organização / Comercial</Label>
          <div className="flex flex-wrap gap-2">
            {TEMPLATE_VARIABLES_ORG.map((v) => (
              <Button key={v.key} type="button" variant="outline" size="sm" className="h-7 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => insertVariable(v.key)}>
                {v.key}
              </Button>
            ))}
          </div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Venda / Renovação</Label>
          <div className="flex flex-wrap gap-2">
            {TEMPLATE_VARIABLES_RENEWAL.map((v) => (
              <Button key={v.key} type="button" variant="outline" size="sm" className="h-7 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => insertVariable(v.key)}>
                {v.key}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Editor and Preview */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="editor">Editor Visual</TabsTrigger>
          <TabsTrigger value="html">HTML</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>

        <TabsContent value="editor" className="mt-4">
          {showComplexWarning && (
            <div className="flex items-start gap-2 p-3 mb-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 text-xs">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                O conteúdo contém HTML avançado (tabelas, divs, estilos). O editor visual pode simplificar o layout. Use a tab <strong>HTML</strong> para editar código complexo sem perda.
              </span>
            </div>
          )}
          <div className="border rounded-md overflow-hidden bg-background">
            <EditorToolbar editor={editor} />
            <EditorContent editor={editor} />
          </div>
        </TabsContent>

        <TabsContent value="html" className="mt-4">
          <Textarea
            ref={htmlTextareaRef}
            value={value}
            onChange={(e) => {
              tiptapSyncedRef.current = false;
              onChange(e.target.value);
            }}
            className="min-h-[400px] font-mono text-sm leading-relaxed"
            placeholder="<p>Escreva o seu HTML aqui...</p>"
          />
        </TabsContent>

        <TabsContent value="preview" className="mt-4" forceMount>
          <div className={cn("border rounded-md bg-white overflow-hidden", activeTab !== "preview" && "hidden")}>
            <iframe ref={iframeRef} title="Email Preview" className="w-full h-[400px] border-0" sandbox="allow-same-origin" />
          </div>
        </TabsContent>
      </Tabs>

      {/* Quick tips */}
      <div className="text-xs text-muted-foreground">
        <p>
          <strong>Dica:</strong> Use a tab <strong>HTML</strong> para colar templates complexos com tabelas e estilos. As variáveis como{" "}
          <code className="bg-muted px-1 py-0.5 rounded">{"{{nome}}"}</code> serão substituídas ao enviar.
        </p>
      </div>
    </div>
  );
}
