export const NO_AUTOMATION_FOLDER = 'none';

export function automationFolderIdFromSelection(selection: string): string | null {
  return selection === NO_AUTOMATION_FOLDER ? null : selection;
}
