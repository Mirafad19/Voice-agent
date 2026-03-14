import React, { useRef } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";

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
        {window.aistudio ? (
          <section className="space-y-4">
            <h4 className="text-lg font-medium text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
              Gemini API
            </h4>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Connect your Gemini API key to enable voice and chat features.
            </p>
            <Button
              onClick={() => window.aistudio?.openSelectKey()}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              Connect Gemini API Key
            </Button>
          </section>
        ) : (
          <section className="space-y-4">
            <h4 className="text-lg font-medium text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
              Gemini API Key
            </h4>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Enter your Gemini API key manually. If you have set the GEMINI_API_KEY environment variable in Vercel, you can leave this blank.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                placeholder="AIzaSy..."
                value={localStorage.getItem('geminiApiKey') || ''}
                onChange={(e) => {
                  localStorage.setItem('geminiApiKey', e.target.value);
                  window.dispatchEvent(new Event('storage')); // Trigger a re-render if needed
                }}
                className="flex-1 p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
              <Button onClick={() => window.location.reload()} variant="secondary">
                Save & Reload
              </Button>
            </div>
          </section>
        )}

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
