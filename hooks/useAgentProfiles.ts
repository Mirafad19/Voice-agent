
import { useState, useEffect, useCallback } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { AgentProfile } from '../types';
import { DEFAULT_PROFILES } from '../constants';

export const useAgentProfiles = () => {
  const [profiles, setProfiles] = useLocalStorage<AgentProfile[]>('agentProfiles', []);
  const [activeProfileId, setActiveProfileId] = useLocalStorage<string | null>('activeProfileId', null);
  const [activeProfile, setActiveProfile] = useState<AgentProfile | null>(null);

  useEffect(() => {
    if (profiles.length === 0) {
      setProfiles(DEFAULT_PROFILES);
      setActiveProfileId(DEFAULT_PROFILES[0].id);
    }
  }, [profiles, setProfiles, setActiveProfileId]);

  useEffect(() => {
    const foundProfile = profiles.find(p => p.id === activeProfileId) || profiles[0] || null;
    setActiveProfile(foundProfile);
    if(foundProfile && activeProfileId !== foundProfile.id) {
        setActiveProfileId(foundProfile.id);
    }
  }, [activeProfileId, profiles, setActiveProfileId]);

  const selectProfile = useCallback((id: string) => {
    setActiveProfileId(id);
  }, [setActiveProfileId]);

  const updateProfile = useCallback((updatedProfile: AgentProfile) => {
    setProfiles(prevProfiles =>
      prevProfiles.map(p => (p.id === updatedProfile.id ? updatedProfile : p))
    );
  }, [setProfiles]);
  
  const createProfile = useCallback((name: string) => {
    const newProfile: AgentProfile = {
        ...DEFAULT_PROFILES[0],
        id: `custom-${Date.now()}`,
        name,
        calloutMessage: 'Hey! Click me to start a voice chat.',
        emailConfig: {
          formspreeEndpoint: '',
        },
        fileUploadConfig: {
          cloudinaryCloudName: '',
          cloudinaryUploadPreset: '',
        }
    };
    setProfiles(prevProfiles => [...prevProfiles, newProfile]);
    setActiveProfileId(newProfile.id);
  }, [setProfiles, setActiveProfileId]);

  const deleteProfile = useCallback((id: string) => {
    if (profiles.length <= 1) {
        alert("You cannot delete the last profile.");
        return;
    }
    setProfiles(prevProfiles => prevProfiles.filter(p => p.id !== id));
    if (activeProfileId === id) {
        setActiveProfileId(profiles.find(p => p.id !== id)?.id || null);
    }
  }, [profiles, activeProfileId, setProfiles, setActiveProfileId]);

  const importProfiles = useCallback((newProfiles: AgentProfile[]) => {
      setProfiles(newProfiles);
      if (newProfiles.length > 0) {
          setActiveProfileId(newProfiles[0].id);
      }
  }, [setProfiles, setActiveProfileId]);

  return {
    profiles,
    activeProfile,
    selectProfile,
    updateProfile,
    createProfile,
    deleteProfile,
    importProfiles,
  };
};
