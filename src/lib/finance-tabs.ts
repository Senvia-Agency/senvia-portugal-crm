/** Organizations on the tabbed finance page: generic ones, and telecom with its own figures. */
export const usesFinanceTabs = (niche: string | null | undefined) => !niche || niche === "generic" || niche === "telecom";
