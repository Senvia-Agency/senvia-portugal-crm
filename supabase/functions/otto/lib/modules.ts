export type OttoModuleKey =
  | "clients"
  | "leads"
  | "sales"
  | "proposals"
  | "finance"
  | "calendar"
  | "marketing"
  | "inbox"
  | "prospects"
  | "portal_total_link"
  | "automations"
  | "settings"
  | "support";

export type OttoPermissionModule =
  | "clients"
  | "leads"
  | "sales"
  | "proposals"
  | "finance"
  | "calendar"
  | "marketing"
  | "inbox"
  | "prospects"
  | "energy"
  | "automations"
  | "settings";

export type OttoModule = {
  readonly key: OttoModuleKey;
  readonly label: string;
  readonly route: `/${string}`;
  readonly permissionModule: OttoPermissionModule;
  readonly availabilityKeys: readonly string[];
  readonly alwaysEnabled: boolean;
  readonly active: boolean;
};

export const OTTO_MODULES = [
  {
    key: "clients",
    label: "Clientes",
    route: "/clients",
    permissionModule: "clients",
    availabilityKeys: ["clients"],
    alwaysEnabled: false,
    active: true,
  },
  {
    key: "leads",
    label: "Leads",
    route: "/leads",
    permissionModule: "leads",
    availabilityKeys: ["leads"],
    alwaysEnabled: false,
    active: true,
  },
  {
    key: "sales",
    label: "Vendas",
    route: "/sales",
    permissionModule: "sales",
    availabilityKeys: ["sales"],
    alwaysEnabled: false,
    active: true,
  },
  {
    key: "proposals",
    label: "Propostas",
    route: "/proposals",
    permissionModule: "proposals",
    availabilityKeys: ["proposals"],
    alwaysEnabled: false,
    active: true,
  },
  {
    key: "finance",
    label: "Financeiro",
    route: "/financeiro",
    permissionModule: "finance",
    availabilityKeys: ["finance"],
    alwaysEnabled: false,
    active: true,
  },
  {
    key: "calendar",
    label: "Agenda",
    route: "/calendar",
    permissionModule: "calendar",
    availabilityKeys: ["calendar"],
    alwaysEnabled: false,
    active: true,
  },
  {
    key: "marketing",
    label: "Marketing",
    route: "/marketing",
    permissionModule: "marketing",
    availabilityKeys: ["marketing"],
    alwaysEnabled: false,
    active: true,
  },
  {
    key: "inbox",
    label: "Caixa de Entrada",
    route: "/inbox",
    permissionModule: "inbox",
    availabilityKeys: ["inbox"],
    alwaysEnabled: false,
    active: true,
  },
  {
    key: "prospects",
    label: "Prospeção",
    route: "/prospects",
    permissionModule: "prospects",
    availabilityKeys: ["prospects"],
    alwaysEnabled: false,
    active: true,
  },
  {
    key: "portal_total_link",
    label: "Portal Total Link",
    route: "/portal-total-link",
    permissionModule: "energy",
    availabilityKeys: ["portal_total_link", "energy"],
    alwaysEnabled: false,
    active: true,
  },
  {
    key: "automations",
    label: "Automações",
    route: "/automacoes",
    permissionModule: "automations",
    availabilityKeys: ["automations"],
    alwaysEnabled: false,
    active: true,
  },
  {
    key: "settings",
    label: "Definições",
    route: "/settings",
    permissionModule: "settings",
    availabilityKeys: ["settings"],
    alwaysEnabled: true,
    active: true,
  },
  {
    key: "support",
    label: "Suporte",
    route: "/settings",
    permissionModule: "settings",
    availabilityKeys: ["support"],
    alwaysEnabled: true,
    active: true,
  },
] as const satisfies readonly OttoModule[];

export const OTTO_MODULE_BY_PERMISSION = {
  clients: "clients",
  leads: "leads",
  sales: "sales",
  proposals: "proposals",
  finance: "finance",
  calendar: "calendar",
  marketing: "marketing",
  inbox: "inbox",
  prospects: "prospects",
  energy: "portal_total_link",
  automations: "automations",
  settings: "settings",
} as const satisfies Record<OttoPermissionModule, OttoModuleKey>;

const OTTO_MODULE_KEYS: ReadonlySet<string> = new Set(
  OTTO_MODULES.map(({ key }) => key),
);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isOttoModuleKey(value: unknown): value is OttoModuleKey {
  return typeof value === "string" && OTTO_MODULE_KEYS.has(value);
}

export function enabledOttoModules(value: unknown): ReadonlySet<OttoModuleKey> {
  const coreModules = OTTO_MODULES.filter(({ alwaysEnabled }) => alwaysEnabled);
  if (Array.isArray(value)) {
    if (!value.every((item): item is string => typeof item === "string")) {
      return new Set(coreModules.map(({ key }) => key));
    }
    const allowList = new Set(value);
    return new Set(
      OTTO_MODULES
        .filter(({ alwaysEnabled, availabilityKeys }) => (
          alwaysEnabled || availabilityKeys.some((key) => allowList.has(key))
        ))
        .map(({ key }) => key),
    );
  }

  if (!isRecord(value)) return new Set(coreModules.map(({ key }) => key));
  return new Set(
    OTTO_MODULES
      .filter(({ alwaysEnabled, availabilityKeys }) => {
        if (alwaysEnabled) return true;
        const explicitValues = availabilityKeys
          .map((key) => value[key])
          .filter((item): item is boolean => typeof item === "boolean");
        return explicitValues.length > 0 && explicitValues.every(Boolean);
      })
      .map(({ key }) => key),
  );
}
