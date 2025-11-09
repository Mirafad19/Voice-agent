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
    style="border:none; background-color: transparent; width: 300px; height: 140px; transition: width 0.3s ease-in-out, height 0.3s ease-in-out;"
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
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          First, enter the public URL where you've deployed this application. This is required to generate the correct embed link.
        </p>
        <Input
          label="Public Hosting URL"
          id="publicUrl"
          type="url"
          placeholder="https://my-agent.vercel.app"
          value={publicUrl}
          onChange={(e) => setPublicUrl(e.target.value)}
        />
        <div className="p-3 bg-yellow-50 dark:bg-gray-700/50 border border-yellow-300 dark:border-yellow-500/50 rounded-lg text-sm text-yellow-800 dark:text-yellow-200">
            <p><strong className="font-semibold">Important:</strong> This embed code is a snapshot of your agent's current settings. If you change the agent's configuration (e.g., knowledge base, voice, email settings), you must copy the new code from this window and update it on your website.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Embed Code
          </label>
          <div className="relative">
            <pre className="bg-gray-100 dark:bg-gray-900 p-4 rounded-md text-sm overflow-x-auto">
              <code>{embedCode}</code>
            </pre>
            <Button
              onClick={handleCopy}
              className="absolute top-2 right-2 px-3 py-1 text-sm"
              variant="secondary"
            >
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
