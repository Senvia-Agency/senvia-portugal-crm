Module dictionaries: one file per module, e.g. `finance.ts`:

    export const ptBR: Record<string, string> = { "Despesas": "Despesas", ... };
    export const en: Record<string, string> = { "Despesas": "Expenses", ... };

Keys are the exact pt-PT text passed to t()/tr(). Merged automatically by src/i18n/index.ts.
