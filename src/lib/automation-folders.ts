import type { AutomationFlow, AutomationFolder } from '@/types/automations';

export interface AutomationFolderGroup<TFolder extends Pick<AutomationFolder, 'id'>, TFlow extends Pick<AutomationFlow, 'folder_id'>> {
  folder: TFolder;
  flows: TFlow[];
}

export function groupAutomationFlows<TFolder extends Pick<AutomationFolder, 'id'>, TFlow extends Pick<AutomationFlow, 'folder_id'>>(
  flows: readonly TFlow[],
  folders: readonly TFolder[],
): { folders: AutomationFolderGroup<TFolder, TFlow>[]; unfiled: TFlow[] } {
  const flowsByFolder = new Map<string, TFlow[]>();
  const folderIds = new Set(folders.map((folder) => folder.id));
  const unfiled: TFlow[] = [];

  for (const flow of flows) {
    if (!flow.folder_id || !folderIds.has(flow.folder_id)) {
      unfiled.push(flow);
      continue;
    }
    const existing = flowsByFolder.get(flow.folder_id) ?? [];
    existing.push(flow);
    flowsByFolder.set(flow.folder_id, existing);
  }

  return {
    folders: folders.map((folder) => ({ folder, flows: flowsByFolder.get(folder.id) ?? [] })),
    unfiled,
  };
}
