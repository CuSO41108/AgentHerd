// The pet's right-click menu (ADR 0075): copy what is selected, a picture or a link, and the
// usual editing in the input. Electron shows no menu of its own, so without this nothing in the
// conversation could be copied with the mouse. Pure, so it is tested without Electron.

/** What Electron tells about the place that was right-clicked (a part of `ContextMenuParams`). */
export interface PetMenuPlace {
  selectionText: string;
  linkURL: string;
  mediaType: string;
  isEditable: boolean;
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean };
}

export type PetMenuAction = "cut" | "copy" | "paste" | "selectAll" | "copyImage" | "copyLink";

export interface PetMenuItem {
  label: string;
  action: PetMenuAction;
}

/** The menu for a place, in order; empty when there is nothing to do there. */
export function petMenuItems(place: PetMenuPlace): PetMenuItem[] {
  const flags = place.editFlags;
  if (place.isEditable) {
    const items: PetMenuItem[] = [];
    if (flags.canCut) items.push({ label: "剪切", action: "cut" });
    if (flags.canCopy) items.push({ label: "复制", action: "copy" });
    if (flags.canPaste) items.push({ label: "粘贴", action: "paste" });
    if (flags.canSelectAll) items.push({ label: "全选", action: "selectAll" });
    return items;
  }
  const items: PetMenuItem[] = [];
  if (place.selectionText.trim() !== "") items.push({ label: "复制", action: "copy" });
  if (place.mediaType === "image") items.push({ label: "复制图片", action: "copyImage" });
  if (/^https?:\/\//i.test(place.linkURL)) items.push({ label: "复制链接", action: "copyLink" });
  return items;
}
