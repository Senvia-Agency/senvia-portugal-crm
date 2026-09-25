import { applySenviaEmailTemplate } from "./senvia-email-template.ts";

Deno.test("SENVIA email template wraps HTML fragments with the shared brand", () => {
  const html = applySenviaEmailTemplate("<p>Olá {{nome}}</p>", "Boas-vindas");
  if (!html.startsWith("<!DOCTYPE html>\n<html lang=\"pt-PT\">")) throw new Error("Missing PT-PT HTML document shell");
  if (!html.includes("https://app.senvia.pt/senvia-logo-white.png")) throw new Error("Missing SENVIA logo");
  if (!html.includes("#F0F4F8") || !html.includes("#1E3A8A") || !html.includes("#2563EB")) throw new Error("Missing SENVIA brand colors");
  if (!html.includes("<p>Olá {{nome}}</p>")) throw new Error("Template body was not preserved");
  if (!html.includes("<title>Boas-vindas</title>")) throw new Error("Template title was not applied");
});

Deno.test("SENVIA email template keeps the original body and head styles", () => {
  const html = applySenviaEmailTemplate("<!doctype html><html><head><style>p{color:red}</style></head><body><p>Conteúdo</p></body></html>");
  if (!html.includes("<style>p{color:red}</style>")) throw new Error("Head styles were not preserved");
  if (!html.includes("<p>Conteúdo</p>")) throw new Error("Body was not extracted");
  if (html.includes("<!doctype html><html>")) throw new Error("Original outer HTML was not replaced");
});

Deno.test("SENVIA email template does not nest an already branded message", () => {
  const first = applySenviaEmailTemplate("<p>Conteúdo</p>");
  const second = applySenviaEmailTemplate(first);
  if (second !== first) throw new Error("Already branded email was wrapped again");
});
