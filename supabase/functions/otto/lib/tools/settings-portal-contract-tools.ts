import type { Tool } from "../types.ts";
import {
  getPortalContractDetails,
  searchPortalContracts,
} from "./settings-portal-contracts.ts";

export const portalContractReadTools = [
  {
    name: "search_portal_energy_contracts",
    module: "portal_total_link",
    description:
      "Pesquisar contratos reais do SENVIA para o Portal Total Link. A fonte suportada é Vendas; áreas PHC ainda não integradas não são simuladas.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Código, cliente, NIF ou número de proposta (opcional)",
        },
        status: {
          type: "string",
          description: "Estado telecom do contrato (opcional)",
        },
        start_date: { type: "string", format: "date" },
        end_date: { type: "string", format: "date" },
        max_results: { type: "integer", minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
    permission: { module: "energy", subarea: "portal", action: "view" },
    execute: searchPortalContracts,
  },
  {
    name: "get_portal_energy_contract_details",
    module: "portal_total_link",
    description:
      "Consultar os detalhes e itens de um contrato SENVIA acessível no âmbito do utilizador.",
    parameters: {
      type: "object",
      properties: {
        sale_id: {
          type: "string",
          format: "uuid",
          description: "ID da venda/contrato",
        },
      },
      required: ["sale_id"],
      additionalProperties: false,
    },
    permission: { module: "energy", subarea: "portal", action: "view" },
    execute: getPortalContractDetails,
  },
] satisfies readonly Tool[];
