

import React from 'react';
import { AgentProfile, WidgetTheme, AgentVoice, AccentColor, EmailConfig, FileUploadConfig } from '../types';
import { Input } from './ui/Input';
import { Select } from './ui/Select';

interface ConfigurationPanelProps {
  profile: AgentProfile;
  onProfileChange: (updatedProfile: AgentProfile) => void;
}

const accentColorOptions = [
    { name: 'Orange', value: AccentColor.Orange, color: 'bg-accent-orange' },
    { name: 'Gold', value: AccentColor.Gold, color: 'bg-accent-gold' },
    { name: 'Cyan', value: AccentColor.Cyan, color: 'bg-accent-cyan' },
    { name: 'Pink', value: AccentColor.Pink, color: 'bg-accent-pink' },
    { name: 'Lime', value: AccentColor.Lime, color: 'bg-accent-lime' },
    { name: 'Violet', value: AccentColor.Violet, color: 'bg-accent-violet' },
    { name: 'Black', value: AccentColor.Black, color: 'bg-accent-black' },
];

export const ConfigurationPanel: React.FC<ConfigurationPanelProps> = ({ profile, onProfileChange }) => {

  const handleChange = <K extends keyof AgentProfile,>(key: K, value: AgentProfile[K]) => {
    onProfileChange({ ...profile, [key]: value });
  };

  const handleEmailConfigChange = <K extends keyof EmailConfig,>(key: K, value: EmailConfig[K]) => {
    onProfileChange({
      ...profile,
      emailConfig: {
        ...(profile.emailConfig || { serviceId: '', templateId: '', publicKey: '', recipientEmail: '' }),
        [key]: value
      }
    });
  };

  const handleFileUploadConfigChange = <K extends keyof FileUploadConfig,>(key: K, value: FileUploadConfig[K]) => {
    onProfileChange({
      ...profile,
      fileUploadConfig: {
        ...(profile.fileUploadConfig || { cloudinaryCloudName: '', cloudinaryUploadPreset: '' }),
        [key]: value
      }
    });
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 space-y-6">
      <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Agent Configuration</h3>
      
      <Input
        label="Agent Name"
        id="agentName"
        value={profile.name}
        onChange={(e) => handleChange('name', e.target.value)}
      />

      <div>
        <Input
          label="Widget Callout Message"
          id="calloutMessage"
          value={profile.calloutMessage || ''}
          onChange={(e) => handleChange('calloutMessage', e.target.value)}
          placeholder="e.g., Hey there! How can I help?"
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">A short, friendly message that appears above the widget button to encourage users to click.</p>
      </div>

      <div>
        <Input
          label="Agent's Initial Greeting"
          id="initialGreeting"
          value={profile.initialGreeting || ''}
          onChange={(e) => handleChange('initialGreeting', e.target.value)}
          placeholder="e.g., Hello, how can I help you today?"
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">The first thing the agent says to start the conversation. This will be spoken out loud.</p>
      </div>

      <div>
        <label htmlFor="knowledgeBase" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Knowledge Base (System Instruction)
        </label>
        <textarea
          id="knowledgeBase"
          rows={8}
          className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
          value={profile.knowledgeBase}
          onChange={(e) => handleChange('knowledgeBase', e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Select
          label="Theme"
          id="theme"
          value={profile.theme}
          onChange={(e) => handleChange('theme', e.target.value as WidgetTheme)}
        >
          <option value={WidgetTheme.Light}>Light</option>
          <option value={WidgetTheme.Dark}>Dark</option>
        </Select>

        <Select
          label="Agent Voice"
          id="voice"
          value={profile.voice}
          onChange={(e) => handleChange('voice', e.target.value as AgentVoice)}
        >
          {Object.values(AgentVoice).map(voice => (
            <option key={voice} value={voice}>{voice}</option>
          ))}
        </Select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Accent Color
        </label>
        <div className="flex items-center space-x-3">
          {accentColorOptions.map(option => (
            <button
              key={option.value}
              type="button"
              className={`w-8 h-8 rounded-full ${option.color} transition-transform transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-800 focus:ring-${option.value}-500 ${profile.accentColor === option.value ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-gray-800 ring-black dark:ring-white' : ''}`}
              onClick={() => handleChange('accentColor', option.value)}
              title={option.name}
            />
          ))}
        </div>
      </div>

      <details className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <summary className="font-semibold cursor-pointer text-gray-900 dark:text-white">Cloud Audio Storage (via Cloudinary)</summary>
        <div className="mt-4 space-y-4 text-sm text-gray-600 dark:text-gray-400">
            <p>
                To include a playable audio link in email reports, the app uploads recordings to cloud storage. This method uses a free <a href="https://cloudinary.com/" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">Cloudinary</a> account, which is simpler and more reliable than other options.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Input
                    label="Cloudinary Cloud Name"
                    id="cloudinaryCloudName"
                    type="text"
                    placeholder="Your Cloudinary cloud name"
                    value={profile.fileUploadConfig?.cloudinaryCloudName || ''}
                    onChange={(e) => handleFileUploadConfigChange('cloudinaryCloudName', e.target.value)}
                />
                <Input
                    label="Cloudinary Upload Preset"
                    id="cloudinaryUploadPreset"
                    type="text"
                    placeholder="Your Cloudinary unsigned preset"
                    value={profile.fileUploadConfig?.cloudinaryUploadPreset || ''}
                    onChange={(e) => handleFileUploadConfigChange('cloudinaryUploadPreset', e.target.value)}
                />
            </div>
            <div className="space-y-3 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-md border border-gray-200 dark:border-gray-700">
                <h4 className="font-semibold text-gray-900 dark:text-white">Setup Instructions:</h4>
                <ol className="list-decimal list-inside space-y-2">
                    <li>Create or log in to your <a href="https://cloudinary.com/users/register/free" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">free Cloudinary Account</a>.</li>
                    <li>From your main Dashboard, copy the <strong>Cloud Name</strong> and paste it into the field above.</li>
                    <li>Go to Settings by clicking the gear icon in the sidebar, then navigate to the <strong>Upload</strong> tab.</li>
                    <li>Scroll down to the "Upload presets" section and click <strong>Add upload preset</strong>.</li>
                    <li>Change the "Signing Mode" from "Signed" to <strong>"Unsigned"</strong>. This is the most important step.</li>
                    <li>(Optional) You can give the preset a more memorable name.</li>
                    <li>Click <strong>Save</strong> at the top of the page.</li>
                    <li>Copy the <strong>Upload preset name</strong> from the list and paste it into the field above. You're all set!</li>
                </ol>
            </div>
            <div className="mt-4 space-y-3 p-4 bg-yellow-50 dark:bg-yellow-900/50 rounded-md border border-yellow-300 dark:border-yellow-700">
                <h4 className="font-semibold text-yellow-900 dark:text-yellow-200">Troubleshooting</h4>
                <p className="text-sm text-yellow-800 dark:text-yellow-300">
                    If your email report shows an "Audio link not available: Failed to fetch" error, it's often caused by a security policy on your website.
                </p>
                <p className="text-sm text-yellow-800 dark:text-yellow-300">
                    <strong>Content Security Policy (CSP):</strong> If your website uses a CSP, it might be blocking the connection to Cloudinary. To fix this, you must add Cloudinary's API endpoint to your policy's <code className="bg-yellow-200 dark:bg-yellow-800/50 px-1 py-0.5 rounded">connect-src</code> directive.
                    <br />
                    Example: <code className="text-xs bg-yellow-200 dark:bg-yellow-800/50 px-1 py-0.5 rounded">connect-src 'self' https://api.cloudinary.com;</code>
                </p>
                <p className="text-sm text-yellow-800 dark:text-yellow-300">
                    Browser extensions like ad-blockers can also sometimes interfere with the upload.
                </p>
            </div>
        </div>
      </details>

      <details className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <summary className="font-semibold cursor-pointer text-gray-900 dark:text-white">Automated Email Reports</summary>
        <div className="mt-4 space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
                Automatically send session recordings and insights to an email address after each conversation in the embedded widget. This requires a free account from <a href="https://www.emailjs.com/" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">EmailJS</a>.
            </p>
            <Input
                label="Recipient Email"
                id="recipientEmail"
                type="email"
                placeholder="Your organization's email"
                value={profile.emailConfig?.recipientEmail || ''}
                onChange={(e) => handleEmailConfigChange('recipientEmail', e.target.value)}
            />
             <Input
                label="EmailJS Service ID"
                id="serviceId"
                type="text"
                placeholder="Your EmailJS Service ID"
                value={profile.emailConfig?.serviceId || ''}
                onChange={(e) => handleEmailConfigChange('serviceId', e.target.value)}
            />
             <Input
                label="EmailJS Template ID"
                id="templateId"
                type="text"
                placeholder="Your EmailJS Template ID"
                value={profile.emailConfig?.templateId || ''}
                onChange={(e) => handleEmailConfigChange('templateId', e.target.value)}
            />
            <Input
                label="EmailJS Public Key"
                id="publicKey"
                type="text"
                placeholder="Your EmailJS Public Key"
                value={profile.emailConfig?.publicKey || ''}
                onChange={(e) => handleEmailConfigChange('publicKey', e.target.value)}
            />
             <div className="text-xs text-gray-500 dark:text-gray-400 space-y-2">
                <p>
                    Note: In your EmailJS template, you can use these variables: 
                    `&#123;&#123;session_name&#125;&#125;`, 
                    `&#123;&#123;agent_name&#125;&#125;` (use for "From Name"),
                    `&#123;&#123;summary&#125;&#125;`, 
                    `&#123;&#123;sentiment&#125;&#125;`, 
                    `&#123;&#123;action_items&#125;&#125;`,
                    and the new `&#123;&#123;audio_link&#125;&#125;`. 
                    For the "Reply-To" field, use `&#123;&#123;email&#125;&#125;`.
                </p>
                <p>
                    <strong className="font-semibold text-yellow-800 dark:text-yellow-300">CRITICAL:</strong> In your EmailJS service settings, go to the "Security" tab and add your website's full URL (e.g., `https://my-site.netlify.app`) to the "Allowed Origins" list.
                </p>
             </div>
        </div>
      </details>
    </div>
  );
};