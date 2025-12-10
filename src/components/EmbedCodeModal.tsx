
import React, { useState, useMemo } from 'react';
import { Modal } from './ui/Modal';
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
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const { embedCode, directLink } = useMemo(() => {
    if (!agentProfile || !apiKey) return { embedCode: '', directLink: '' };
    
    const { id, ...config }: { id: string; [key: string]: any } & AgentConfig = agentProfile;

    const encodedConfig = safeBtoa(JSON.stringify(config));
    const baseUrl = publicUrl || 'YOUR_HOSTED_URL';
    const finalUrl = `${baseUrl}?config=${encodedConfig}&apiKey=${apiKey}`;
    const iframeId = `ai-agent-iframe-${Date.now()}`;

    // The script now checks for mobile viewport width (< 768px) and adjusts the iframe style accordingly.
    const code = `<div style="position: fixed; bottom: 20px; right: 20px; z-index: 9999;">
  <iframe
    id="${iframeId}"
    src="${finalUrl}"
    style="border: none; outline: none; background-color: transparent; width: 300px; height: 140px; transition: width 0.3s ease-in-out, height 0.3s ease-in-out; border-radius: 12px;"
    allow="microphone"
    frameborder="0"
    title="${agentProfile.name}"
  ></iframe>
</div>
<script>
  (function() {
    var iframe = document.getElementById('${iframeId}');
    var container = iframe.parentElement;
    
    window.addEventListener('message', function(event) {
      if (event.source !== iframe.contentWindow) return;
      if (event.data && event.data.type === 'agent-widget-resize') {
        var isMobile = window.innerWidth < 768;
        var isOpen = event.data.isOpen;
        
        if (isMobile && isOpen) {
            // Full screen on mobile
            container.style.bottom = '0';
            container.style.right = '0';
            container.style.left = '0';
            container.style.top = '0';
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.borderRadius = '0';
        } else {
            // Floating widget on desktop or closed state
            container.style.bottom = '20px';
            container.style.right = '20px';
            container.style.left = 'auto';
            container.style.top = 'auto';
            iframe.style.width = event.data.width + 'px';
            iframe.style.height = event.data.height + 'px';
            iframe.style.borderRadius = isOpen ? '16px' : '0px'; // Remove border radius if it's just a button
            iframe.style.boxShadow = isOpen ? '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)' : 'none';
        }
      }
    });
  })();
</script>`;

    return { embedCode: code, directLink: finalUrl };
  }, [agentProfile, apiKey, publicUrl]);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(embedCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(directLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Get Code">
      <div className="flex flex-col gap-6">
        
        {/* 1. URL Input */}
        <div className="flex flex-col gap-2">
            <label className="text-xs font-bold uppercase text-gray-500 dark:text-gray-400">
                Hosting URL (Required)
            </label>
            <input
                type="url"
                value={publicUrl}
                onChange={(e) => setPublicUrl(e.target.value)}
                placeholder="https://your-app.vercel.app"
                className="w-full p-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
        </div>

        {/* 2. The Code (Middle - Dark, Scrollable) */}
        <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
                <label className="text-xs font-bold uppercase text-gray-500 dark:text-gray-400">
                    Embed Code
                </label>
                <Button onClick={handleCopyCode} className="py-1 px-3 text-xs h-8">
                    {copiedCode ? 'Copied!' : 'Copy Code'}
                </Button>
            </div>
            <div className="relative">
                <pre className="h-64 w-full p-4 bg-gray-950 text-green-400 font-mono text-xs rounded-lg overflow-y-auto border border-gray-800 shadow-inner">
                    {embedCode}
                </pre>
            </div>
        </div>

        {/* 3. The Link (Bottom) */}
        <div className="flex flex-col gap-2 pt-4 border-t border-gray-200 dark:border-gray-700">
             <label className="text-xs font-bold uppercase text-gray-500 dark:text-gray-400">
                Direct Link
             </label>
             <div className="flex gap-2">
                 <input 
                    readOnly
                    value={directLink}
                    className="flex-1 p-2 text-xs bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-gray-600 dark:text-gray-300 select-all"
                 />
                 <Button onClick={handleCopyLink} variant="secondary" className="py-1 px-3 text-xs whitespace-nowrap h-9">
                    {copiedLink ? 'Copied!' : 'Copy Link'}
                 </Button>
             </div>
        </div>

      </div>
    </Modal>
  );
};
