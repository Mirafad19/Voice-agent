

import React, { useState, useMemo, useEffect } from 'react';
import { Modal } from './ui/Modal';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { AgentProfile, AgentConfig } from '../types';
import { safeBtoa } from '../utils';
import { useLocalStorage } from '../hooks/useLocalStorage';

interface EmbedCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  agentProfile: AgentProfile | null;
  apiKey: string | null;
}

export const EmbedCodeModal: React.FC<EmbedCodeModalProps> = ({ isOpen, onClose, agentProfile, apiKey }) => {
  const [publicUrl, setPublicUrl] = useLocalStorage<string>('publicHostingUrl', '');
  const [copied, setCopied] = useState(false);

  const embedCode = useMemo(() => {
    if (!agentProfile || !apiKey) return '';
    
    const { id, ...config }: { id: string; [key: string]: any } & AgentConfig = agentProfile;

    const encodedConfig = safeBtoa(JSON.stringify(config));
    const url = publicUrl || 'YOUR_HOSTED_URL';
    const finalUrl = `${url}?config=${encodedConfig}&apiKey=${apiKey}`;
    const iframeId = `ai-agent-iframe-${Date.now()}`;

    return `<div style="position: fixed; bottom: 20px; right: 20px; z-index: 9999;">
  <iframe
    id="${iframeId}"
    src="${finalUrl}"
    style="border: none; outline: none; background-color: transparent; width: 300px; height: 140px; transition: width 0.3s ease-in-out, height 0.3s ease-in-out;"
    allow="microphone"
    frameborder="0"
    title="${agentProfile.name}"
  ></iframe>
</div>
<script>
  (function() {
    var iframe = document.getElementById('${iframeId}');
    window.addEventListener('message', function(event) {
      // Security: Ensure message is from the iframe
      if (event.source !== iframe.contentWindow) {
        return;
      }
      if (event.data && event.data.type === 'agent-widget-resize') {
        iframe.style.width = event.data.width + 'px';
        iframe.style.height = event.data.height + 'px';
      }
    });
  })();
</script>`;
  }, [agentProfile, apiKey, publicUrl]);

  const handleCopy = () => {
    navigator.clipboard.writeText(embedCode);
    setCopied(true);
  };

  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Embed Your Agent">
      <div className="space-y-6">
        <div>
          <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Step 1: Set Your Public URL</h4>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
            Enter the public URL where you've deployed this application. This is required to generate the correct embed link.
          </p>
          <Input
            label="Public Hosting URL"
            id="publicUrl"
            type="url"
            placeholder="https://my-agent.vercel.app"
            value={publicUrl}
            onChange={(e) => setPublicUrl(e.target.value)}
          />
        </div>

        <div className="space-y-3 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-md border border-gray-200 dark:border-gray-700">
            <h4 className="font-semibold text-gray-900 dark:text-white">Step 2: How to Use the Embed Code</h4>
            <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700 dark:text-gray-300">
                <li>Copy the complete code snippet generated below.</li>
                <li>Open the HTML file of the website where you want the agent to appear.</li>
                <li>Paste the code right before the closing <strong>&lt;/body&gt;</strong> tag.</li>
                <li><strong>Important:</strong> If you already have an old version of the widget on your site, make sure to find and delete the old embed code before pasting the new one.</li>
            </ol>
        </div>

        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Step 3: Copy Your Code
            </label>
            <Button
              onClick={handleCopy}
              className="px-3 py-1 text-sm"
              variant="secondary"
            >
              {copied ? 'Copied!' : 'Copy Code'}
            </Button>
          </div>
          <pre className="bg-gray-100 dark:bg-gray-900 p-4 rounded-md text-sm overflow-x-auto">
            <code>{embedCode}</code>
          </pre>
        </div>
        
        <div className="p-3 bg-yellow-50 dark:bg-gray-700/50 border border-yellow-300 dark:border-yellow-500/50 rounded-lg text-sm text-yellow-800 dark:text-yellow-200">
            <p><strong className="font-semibold">Remember:</strong> This embed code is a snapshot of your agent's current settings. If you change the agent's configuration, you must generate and paste a new code snippet to apply the updates to your website.</p>
        </div>
      </div>
    </Modal>
  );
};
