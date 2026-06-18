import React, { useRef, useState, useEffect } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { KeyRotator } from "../services/keyRotator";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExportProfiles: () => void;
  onImportProfiles: (file: File) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onExportProfiles,
  onImportProfiles,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [newKey, setNewKey] = useState("");
  const [testingStatus, setTestingStatus] = useState<Record<string, "idle" | "validating" | "valid" | "invalid">>({});

  useEffect(() => {
    if (isOpen) {
      setKeys(KeyRotator.getKeys());
    }
  }, [isOpen]);

  const handleAddKey = () => {
    const trimmed = newKey.trim();
    if (!trimmed) return;
    if (keys.includes(trimmed)) {
      alert("This key is already in the rotation pool!");
      return;
    }
    const updated = [...keys, trimmed];
    setKeys(updated);
    KeyRotator.saveKeys(updated);
    setNewKey("");
  };

  const handleRemoveKey = (indexToRemove: number) => {
    const updated = keys.filter((_, i) => i !== indexToRemove);
    setKeys(updated);
    KeyRotator.saveKeys(updated);
  };

  const validateKey = async (key: string) => {
    setTestingStatus((prev) => ({ ...prev, [key]: "validating" }));
    try {
      // Use standard models endpoint as a lightweight test
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      if (res.ok) {
        setTestingStatus((prev) => ({ ...prev, [key]: "valid" }));
      } else {
        setTestingStatus((prev) => ({ ...prev, [key]: "invalid" }));
      }
    } catch (e) {
      setTestingStatus((prev) => ({ ...prev, [key]: "invalid" }));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImportProfiles(file);
      e.target.value = "";
    }
  };

  const triggerImport = () => fileInputRef.current?.click();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings & Data">
      <div className="space-y-8">
        <section className="space-y-4">
          <h4 className="text-lg font-medium text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2 flex items-center justify-between">
            <span>Gemini API Key Pool (Multi-Key Rotation)</span>
            <span className="text-xs font-semibold px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded-full dark:bg-indigo-900/40 dark:text-indigo-300">
              {keys.length} Keys Configured
            </span>
          </h4>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Add up to 5 Gemini API Keys. The voice agent will automatically rotate requests among active, healthy keys. If any key hits a quota or rate-limit (429), it will be temporarily sidelined and the system will automatically failover to ensure an uninterrupted experience.
          </p>

          <div className="flex gap-2">
            <input
              type="password"
              placeholder="Paste Gemini API Key (starts with AIzaSy...)"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              className="flex-1 p-2 text-sm border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
            <Button onClick={handleAddKey} className="bg-indigo-600 hover:bg-indigo-700 text-white">
              Add Key
            </Button>
          </div>

          {keys.length > 0 ? (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden divide-y divide-gray-100 dark:divide-gray-800 bg-gray-50/50 dark:bg-gray-900/30">
              {keys.map((key, index) => {
                const status = testingStatus[key] || "idle";
                return (
                  <div key={index} className="p-3 flex items-center justify-between text-sm gap-4">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span className="font-mono text-xs text-gray-400 font-bold">#{index + 1}</span>
                      <span className="font-mono text-xs text-gray-700 dark:text-gray-300 truncate">
                        {key.substring(0, 8)}...{key.substring(key.length - 6)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {status === "idle" && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">Untested</span>
                      )}
                      {status === "validating" && (
                        <span className="text-xs text-amber-500 animate-pulse flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping"></span>
                          Testing...
                        </span>
                      )}
                      {status === "valid" && (
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-900/40">
                          ● Active & Valid
                        </span>
                      )}
                      {status === "invalid" && (
                        <span className="text-xs font-semibold text-red-600 dark:text-red-400 flex items-center gap-1 bg-red-50 dark:bg-red-950/40 px-2 py-0.5 rounded border border-red-200 dark:border-red-900/40">
                          ● Invalid / Expired
                        </span>
                      )}

                      <Button
                        onClick={() => validateKey(key)}
                        variant="secondary"
                        disabled={status === "validating"}
                        className="py-1 px-2.5 h-7 text-xs"
                      >
                        Test
                      </Button>
                      <Button
                        onClick={() => handleRemoveKey(index)}
                        variant="danger"
                        className="py-1 px-2.5 h-7 text-xs bg-red-600/10 hover:bg-red-600 text-red-600 hover:text-white border border-red-200 dark:border-red-900/40"
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-center py-4 bg-gray-50 dark:bg-gray-800/40 rounded-lg text-gray-500 border border-dashed border-gray-200 dark:border-gray-800">
              No keys in pool yet. Add at least one Gemini API Key to enable the assistant.
            </p>
          )}
        </section>

        <section className="space-y-4">
          <h4 className="text-lg font-medium text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
            Data Backup & Restore
          </h4>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Configurations are stored in-browser. Backup regularly.
          </p>
          <div className="flex gap-4">
            <Button
              onClick={onExportProfiles}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
            >
              Download Backup
            </Button>
            <Button
              onClick={triggerImport}
              variant="secondary"
              className="flex-1"
            >
              Restore Backup
            </Button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".json"
              className="hidden"
            />
          </div>
        </section>
      </div>
    </Modal>
  );
};
