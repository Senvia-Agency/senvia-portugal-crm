import type { Tool } from "../types.ts";
import { getExpenseDetails, searchExpenses } from "./finance-expense-read.ts";

export const financeExpenseReadTools = [
  {
    name: "search_expenses",
    module: "finance",
    description:
      "Pesquisar despesas reais por texto, período ou recorrência, limitadas à organização e ao âmbito de dados do utilizador.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Descrição ou nota (opcional)" },
        start_date: {
          type: "string",
          format: "date",
          description: "Data inicial YYYY-MM-DD (opcional)",
        },
        end_date: {
          type: "string",
          format: "date",
          description: "Data final YYYY-MM-DD (opcional)",
        },
        is_recurring: {
          type: "boolean",
          description: "Filtrar recorrentes (opcional)",
        },
        max_results: { type: "integer", minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
    permission: { module: "finance", subarea: "expenses", action: "view" },
    execute: searchExpenses,
  },
  {
    name: "get_expense_details",
    module: "finance",
    description:
      "Consultar uma despesa específica, incluindo categoria, recorrência e nome da conta, sem devolver IBAN nem ficheiros.",
    parameters: {
      type: "object",
      properties: {
        expense_id: {
          type: "string",
          format: "uuid",
          description: "ID interno da despesa",
        },
      },
      required: ["expense_id"],
      additionalProperties: false,
    },
    permission: { module: "finance", subarea: "expenses", action: "view" },
    execute: getExpenseDetails,
  },
] satisfies readonly Tool[];
