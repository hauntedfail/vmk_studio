import { useCallback, useEffect, useState } from "react";
import type { CustomBehaviorDef, FirmwareModel } from "../types";
import {
  deleteCustomBehavior,
  getGitDiff,
  readRepoFile,
  revertRepoFile,
  upsertCustomBehavior,
  writeRepoFile,
} from "../api";
import { CodeBlock } from "@/components/ui/code-block";
import { DeleteButton } from "@/components/ui/delete-button";
import { toast } from "@/components/ui/toast";
import {
  Edit3,
  Eye,
  FileCode2,
  GitCompare,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";

interface CustomBehaviorsAndFilesViewProps {
  firmwareModel: FirmwareModel | null;
  initialFile?: string;
  onModelUpdated: (model: FirmwareModel) => void;
  onRefreshModel: () => Promise<void>;
}

type BehaviorTemplateKey = "cg-toggle" | "cg-zoom" | "cg-nav" | "macro" | "hold-tap";

const INPUT_CLS =
  "h-8 px-2.5 rounded-lg bg-recess border border-border text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[#FC4C01]";

function languageFromPath(relPath: string): string {
  if (relPath.endsWith(".c") || relPath.endsWith(".h")) return "c";
  if (relPath.endsWith(".swift")) return "swift";
  if (relPath.endsWith(".json")) return "json";
  if (relPath.endsWith(".conf") || relPath === "Kconfig") return "bash";
  return "c";
}

function makeTemplate(kind: BehaviorTemplateKey): CustomBehaviorDef {
  if (kind === "cg-toggle") {
    return {
      label: "cg_toggle_custom",
      nodeName: "cg_toggle_custom",
      compatible: "zmk,behavior-cg-toggle",
      bindingCells: 0,
      displayName: "Custom CG Toggle",
      sourceFile: "dts/cg_toggle.dtsi",
      properties: { "toggle-mode": "flip" },
    };
  }
  if (kind === "cg-zoom") {
    return {
      label: "cg_zoom_custom",
      nodeName: "cg_zoom_custom",
      compatible: "zmk,behavior-cg-zoom",
      bindingCells: 0,
      displayName: "Custom Zoom",
      sourceFile: "dts/cg_toggle.dtsi",
      properties: { direction: "smart" },
    };
  }
  if (kind === "cg-nav") {
    return {
      label: "cg_nav_custom",
      nodeName: "cg_nav_custom",
      compatible: "zmk,behavior-cg-nav",
      bindingCells: 0,
      displayName: "Custom Browser Nav",
      sourceFile: "dts/cg_toggle.dtsi",
      properties: { direction: "back" },
    };
  }
  if (kind === "macro") {
    return {
      label: "my_macro",
      nodeName: "my_macro",
      compatible: "zmk,behavior-macro",
      bindingCells: 0,
      displayName: "My Macro",
      sourceFile: "dts/cg_toggle.dtsi",
      properties: {
        "wait-ms": "<30>",
        "tap-ms": "<30>",
        bindings: "<&kp LC(C)>",
      },
    };
  }
  return {
    label: "hrm",
    nodeName: "hrm",
    compatible: "zmk,behavior-hold-tap",
    bindingCells: 2,
    displayName: "Home Row Mod",
    sourceFile: "dts/cg_toggle.dtsi",
    properties: {
      flavor: "balanced",
      "tapping-term-ms": "<200>",
      "quick-tap-ms": "<175>",
      "require-prior-idle-ms": "<125>",
      bindings: "<&kp>, <&kp>",
    },
  };
}

export const CustomBehaviorsAndFilesView = ({
  firmwareModel,
  initialFile,
  onModelUpdated,
  onRefreshModel,
}: CustomBehaviorsAndFilesViewProps) => {
  const [selectedRelPath, setSelectedRelPath] = useState<string>(
    initialFile || "config/toucan.keymap"
  );
  const [rightMode, setRightMode] = useState<"editor" | "behavior-form">("behavior-form");
  const [sourceMode, setSourceMode] = useState<"view" | "edit" | "diff">("view");
  const [editingBehavior, setEditingBehavior] = useState<CustomBehaviorDef | null>(null);
  const [newPropKey, setNewPropKey] = useState("");
  const [newPropVal, setNewPropVal] = useState("");

  const [content, setContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [diffText, setDiffText] = useState("");

  useEffect(() => {
    if (initialFile) {
      setSelectedRelPath(initialFile);
      setRightMode("editor");
    }
  }, [initialFile]);

  useEffect(() => {
    if (!editingBehavior && firmwareModel?.customBehaviors.length) {
      const first = firmwareModel.customBehaviors[0];
      setEditingBehavior({ ...first, properties: { ...first.properties } });
    }
  }, [firmwareModel, editingBehavior]);

  const loadFile = useCallback(
    async (rel: string) => {
      if (!firmwareModel) return;
      setLoading(true);
      try {
        const text = await readRepoFile(firmwareModel.repoPath, rel);
        setContent(text);
        setOriginalContent(text);
        if (sourceMode === "diff") {
          const d = await getGitDiff(firmwareModel.repoPath, rel);
          setDiffText(d || `# No git diff for ${rel}`);
        }
      } catch (e) {
        toast.error(`Failed loading ${rel}`, {
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setLoading(false);
      }
    },
    [firmwareModel, sourceMode]
  );

  useEffect(() => {
    loadFile(selectedRelPath);
  }, [selectedRelPath, loadFile]);

  const isDirty = content !== originalContent;

  const handleSaveFile = useCallback(async () => {
    if (!firmwareModel || !isDirty) return;
    setSaving(true);
    try {
      await writeRepoFile(firmwareModel.repoPath, selectedRelPath, content);
      setOriginalContent(content);
      toast.success(`Saved ${selectedRelPath}`);
      await onRefreshModel();
    } catch (e) {
      toast.error("Failed to save file", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }, [firmwareModel, isDirty, selectedRelPath, content, onRefreshModel]);

  const handleSaveBehavior = async () => {
    if (!firmwareModel || !editingBehavior) return;
    setSaving(true);
    try {
      const updated = await upsertCustomBehavior(
        firmwareModel.repoPath,
        editingBehavior
      );
      onModelUpdated(updated);
      setSelectedRelPath(editingBehavior.sourceFile);
      await loadFile(editingBehavior.sourceFile);
      toast.success(`Saved &${editingBehavior.label}`, {
        description: editingBehavior.sourceFile,
      });
    } catch (e) {
      toast.error("Failed to write custom behavior", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteBehavior = async (b: CustomBehaviorDef) => {
    if (!firmwareModel) return;
    setSaving(true);
    try {
      const updated = await deleteCustomBehavior(
        firmwareModel.repoPath,
        b.sourceFile,
        b.label
      );
      onModelUpdated(updated);
      const nextFirst = updated.customBehaviors[0];
      if (nextFirst) {
        setEditingBehavior({ ...nextFirst, properties: { ...nextFirst.properties } });
      } else {
        setEditingBehavior(null);
        setRightMode("editor");
      }
      await loadFile(b.sourceFile);
      toast.info(`Deleted &${b.label}`);
    } catch (e) {
      toast.error("Failed to delete behavior", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRevert = async () => {
    if (!firmwareModel) return;
    if (
      !window.confirm(
        `Revert ${selectedRelPath} to git HEAD? Uncommitted changes in this file will be discarded.`
      )
    ) {
      return;
    }
    try {
      await revertRepoFile(firmwareModel.repoPath, selectedRelPath);
      await loadFile(selectedRelPath);
      await onRefreshModel();
      toast.info(`Reverted ${selectedRelPath} to HEAD`);
    } catch (e) {
      toast.error("Revert failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (rightMode === "editor") {
          handleSaveFile();
        } else {
          handleSaveBehavior();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSaveFile, rightMode, editingBehavior]);

  if (!firmwareModel) {
    return (
      <div className="h-full flex items-center justify-center p-8 text-xs font-mono text-muted-foreground">
        Loading firmware repository…
      </div>
    );
  }

  return (
    <div className="h-full grid grid-cols-[290px_1fr] bg-background overflow-hidden">
      {/* Left Rail: Custom Behaviors + Files */}
      <aside className="bg-surface border-r border-border flex flex-col overflow-hidden">
        <div className="p-3 border-b border-border space-y-2 max-h-[50%] overflow-y-auto">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Custom Behaviors ({firmwareModel.customBehaviors.length})
            </span>
            <button
              type="button"
              onClick={() => {
                setEditingBehavior(makeTemplate("macro"));
                setRightMode("behavior-form");
              }}
              className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-recess border border-border text-[11px] font-medium text-foreground hover:border-[#FC4C01]"
            >
              <Plus className="w-3 h-3 text-[#FC4C01]" />
              New
            </button>
          </div>

          <div className="space-y-1">
            {firmwareModel.customBehaviors.map((b) => {
              const selected =
                rightMode === "behavior-form" && editingBehavior?.label === b.label;
              return (
                <button
                  key={`${b.sourceFile}-${b.label}`}
                  type="button"
                  onClick={() => {
                    setEditingBehavior({ ...b, properties: { ...b.properties } });
                    setRightMode("behavior-form");
                  }}
                  className={`w-full text-left px-2.5 py-2 rounded-xl border transition-colors ${
                    selected
                      ? "bg-muted border-border text-foreground"
                      : "border-transparent hover:bg-recess/60 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-foreground truncate">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          selected ? "bg-[#FC4C01]" : "bg-muted-foreground/50"
                        }`}
                      />
                      <span className="truncate">{b.displayName}</span>
                    </span>
                    <code className="text-[10px] font-mono text-muted-foreground shrink-0">
                      &amp;{b.label}
                    </code>
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground truncate mt-0.5 pl-3">
                    {b.compatible} · {b.bindingCells} arg{b.bindingCells === 1 ? "" : "s"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-3 flex-1 overflow-y-auto space-y-1">
          <div className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <FileCode2 className="w-3.5 h-3.5" />
            Repository Files
          </div>
          {firmwareModel.editableFiles
            .filter((f) => f.exists)
            .map((f) => {
              const active = rightMode === "editor" && selectedRelPath === f.relPath;
              return (
                <button
                  key={f.relPath}
                  type="button"
                  onClick={() => {
                    setSelectedRelPath(f.relPath);
                    setRightMode("editor");
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                    active
                      ? "bg-muted text-foreground font-medium border border-border"
                      : "text-muted-foreground hover:text-foreground hover:bg-recess/60 border border-transparent"
                  }`}
                >
                  <span className="truncate font-mono">{f.label}</span>
                  {f.modified && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-[#FC4C01] shrink-0"
                      title="Modified in git"
                    />
                  )}
                </button>
              );
            })}
        </div>
      </aside>

      {/* Right Pane */}
      {rightMode === "behavior-form" && editingBehavior ? (
        <div className="flex flex-col min-w-0 min-h-0 overflow-hidden bg-background">
          <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 bg-surface border-b border-border text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#FC4C01]" />
              <span className="font-semibold text-foreground">
                {editingBehavior.displayName}
              </span>
              <code className="font-mono text-muted-foreground">
                &amp;{editingBehavior.label}
              </code>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedRelPath(editingBehavior.sourceFile);
                  setRightMode("editor");
                }}
                className="h-8 px-3 rounded-lg bg-recess border border-border text-xs font-medium text-foreground hover:bg-muted"
              >
                Open Raw DTS
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveBehavior}
                className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-[#FC4C01] text-white font-medium hover:opacity-90 disabled:opacity-35"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? "Saving..." : "Write DTS"}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto space-y-5 text-xs">
              {/* Templates */}
              <div className="vmk-card rounded-2xl p-4 space-y-2.5">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  New Behavior Templates
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ["macro", "ZMK Macro"],
                      ["hold-tap", "Custom Hold-Tap"],
                      ["cg-toggle", "Ctrl/GUI Toggle"],
                      ["cg-zoom", "Zoom / Smart Zoom"],
                      ["cg-nav", "OS-Aware Nav"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setEditingBehavior(makeTemplate(key))}
                      className="h-7 px-2.5 rounded-lg bg-recess border border-border text-foreground hover:border-[#FC4C01] font-medium transition-colors"
                    >
                      + {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* DTS Node Fields */}
              <div className="vmk-card rounded-2xl p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-muted-foreground font-medium">DTS Label (&amp;label)</span>
                    <input
                      type="text"
                      value={editingBehavior.label}
                      onChange={(e) =>
                        setEditingBehavior({
                          ...editingBehavior,
                          label: e.target.value,
                          nodeName: e.target.value,
                        })
                      }
                      className={INPUT_CLS}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-muted-foreground font-medium">Studio Display Name</span>
                    <input
                      type="text"
                      value={editingBehavior.displayName}
                      onChange={(e) =>
                        setEditingBehavior({
                          ...editingBehavior,
                          displayName: e.target.value,
                        })
                      }
                      className={`${INPUT_CLS} font-sans`}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-muted-foreground font-medium">compatible</span>
                    <input
                      type="text"
                      value={editingBehavior.compatible}
                      onChange={(e) =>
                        setEditingBehavior({
                          ...editingBehavior,
                          compatible: e.target.value,
                        })
                      }
                      className={INPUT_CLS}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-muted-foreground font-medium whitespace-nowrap">
                        #binding-cells
                      </span>
                      <select
                        value={editingBehavior.bindingCells}
                        onChange={(e) =>
                          setEditingBehavior({
                            ...editingBehavior,
                            bindingCells: parseInt(e.target.value, 10),
                          })
                        }
                        className={INPUT_CLS}
                      >
                        <option value={0}>0 args</option>
                        <option value={1}>1 arg</option>
                        <option value={2}>2 args</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-muted-foreground font-medium whitespace-nowrap">
                        Target File
                      </span>
                      <input
                        type="text"
                        value={editingBehavior.sourceFile}
                        onChange={(e) =>
                          setEditingBehavior({
                            ...editingBehavior,
                            sourceFile: e.target.value,
                          })
                        }
                        className={INPUT_CLS}
                      />
                    </label>
                  </div>
                </div>

                {/* Properties */}
                <div className="pt-4 border-t border-border space-y-2.5">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                    DTS Properties
                  </div>
                  {Object.entries(editingBehavior.properties).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2">
                      <code className="w-40 h-8 flex items-center px-2.5 rounded-lg bg-recess border border-border font-mono truncate text-muted-foreground">
                        {k}
                      </code>
                      {k === "toggle-mode" ? (
                        <select
                          value={v}
                          onChange={(e) =>
                            setEditingBehavior({
                              ...editingBehavior,
                              properties: { ...editingBehavior.properties, [k]: e.target.value },
                            })
                          }
                          className={`${INPUT_CLS} flex-1`}
                        >
                          <option value="flip">flip</option>
                          <option value="on">on</option>
                          <option value="off">off</option>
                        </select>
                      ) : k === "direction" &&
                        editingBehavior.compatible === "zmk,behavior-cg-zoom" ? (
                        <select
                          value={v}
                          onChange={(e) =>
                            setEditingBehavior({
                              ...editingBehavior,
                              properties: { ...editingBehavior.properties, [k]: e.target.value },
                            })
                          }
                          className={`${INPUT_CLS} flex-1`}
                        >
                          <option value="in">in</option>
                          <option value="out">out</option>
                          <option value="smart">smart</option>
                        </select>
                      ) : k === "direction" &&
                        editingBehavior.compatible === "zmk,behavior-cg-nav" ? (
                        <select
                          value={v}
                          onChange={(e) =>
                            setEditingBehavior({
                              ...editingBehavior,
                              properties: { ...editingBehavior.properties, [k]: e.target.value },
                            })
                          }
                          className={`${INPUT_CLS} flex-1`}
                        >
                          <option value="back">back</option>
                          <option value="forward">forward</option>
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={v}
                          onChange={(e) =>
                            setEditingBehavior({
                              ...editingBehavior,
                              properties: { ...editingBehavior.properties, [k]: e.target.value },
                            })
                          }
                          className={`${INPUT_CLS} flex-1`}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const nextProps = { ...editingBehavior.properties };
                          delete nextProps[k];
                          setEditingBehavior({ ...editingBehavior, properties: nextProps });
                        }}
                        className="grid h-8 w-8 place-items-center rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={newPropKey}
                      onChange={(e) => setNewPropKey(e.target.value)}
                      placeholder="property-name"
                      className={`${INPUT_CLS} w-36 min-w-0`}
                    />
                    <input
                      type="text"
                      value={newPropVal}
                      onChange={(e) => setNewPropVal(e.target.value)}
                      placeholder='value (<30>, "balanced", true)'
                      className={`${INPUT_CLS} flex-1 min-w-[140px]`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!newPropKey.trim()) return;
                        setEditingBehavior({
                          ...editingBehavior,
                          properties: {
                            ...editingBehavior.properties,
                            [newPropKey.trim()]: newPropVal.trim() || "true",
                          },
                        });
                        setNewPropKey("");
                        setNewPropVal("");
                      }}
                      className="h-8 px-3 rounded-lg bg-recess border border-border text-foreground hover:bg-muted font-medium whitespace-nowrap shrink-0"
                    >
                      + Add Prop
                    </button>
                  </div>
                </div>

                {/* Rare UI Animated Confirm-to-Delete */}
                {firmwareModel.customBehaviors.some(
                  (b) => b.label === editingBehavior.label
                ) && (
                  <div className="pt-4 border-t border-border flex items-center justify-between gap-4">
                    <div>
                      <div className="font-medium text-foreground">Remove Behavior Node</div>
                      <p className="text-[11px] text-muted-foreground">
                        Removes <code>&amp;{editingBehavior.label}</code> from{" "}
                        <code>{editingBehavior.sourceFile}</code>.
                      </p>
                    </div>
                    <DeleteButton
                      aria-label={`Delete ${editingBehavior.label}`}
                      onConfirm={() => handleDeleteBehavior(editingBehavior)}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col min-w-0 min-h-0 bg-background">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 bg-surface border-b border-border text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <code className="font-mono font-semibold text-foreground truncate">
                {selectedRelPath}
              </code>
              {isDirty && (
                <span className="px-2 py-0.5 rounded-full bg-[#FC4C01]/15 text-[#FC4C01] text-[10px] font-medium">
                  Unsaved
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-lg bg-recess p-0.5 border border-border">
                <button
                  type="button"
                  onClick={() => setSourceMode("view")}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium ${
                    sourceMode === "view"
                      ? "bg-surface text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Eye className="w-3 h-3" />
                  Read
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode("edit")}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium ${
                    sourceMode === "edit"
                      ? "bg-surface text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Edit3 className="w-3 h-3" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setSourceMode("diff");
                    const d = await getGitDiff(firmwareModel.repoPath, selectedRelPath);
                    setDiffText(d || `# No git diff for ${selectedRelPath}`);
                  }}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium ${
                    sourceMode === "diff"
                      ? "bg-surface text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <GitCompare className="w-3 h-3" />
                  Diff
                </button>
              </div>

              <button
                type="button"
                onClick={handleRevert}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-recess border border-border text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="w-3 h-3" />
                Revert
              </button>
              <button
                type="button"
                disabled={!isDirty || saving}
                onClick={handleSaveFile}
                className="inline-flex items-center gap-1 h-7 px-3 rounded-lg bg-[#FC4C01] text-white font-medium disabled:opacity-35"
              >
                <Save className="w-3 h-3" />
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>

          <div className="flex-1 flex min-h-0 overflow-hidden p-4">
            {loading ? (
              <div className="flex-1 flex items-center justify-center text-xs font-mono text-muted-foreground">
                Loading {selectedRelPath}…
              </div>
            ) : sourceMode === "view" ? (
              <CodeBlock
                code={content}
                language={languageFromPath(selectedRelPath)}
                filename={selectedRelPath}
                accent="#FC4C01"
                className="w-full h-full"
              />
            ) : sourceMode === "diff" ? (
              <CodeBlock
                code={diffText}
                language="diff"
                filename={`${selectedRelPath} (git diff)`}
                accent="#FC4C01"
                className="w-full h-full"
              />
            ) : (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
                className="flex-1 w-full h-full p-4 rounded-2xl border border-border font-mono text-xs leading-relaxed bg-recess text-foreground focus:outline-none focus:border-[#FC4C01] resize-none"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};
