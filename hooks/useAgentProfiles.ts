
import { useState, useEffect, useCallback } from 'react';
import { AgentProfile } from '../types';
import { DEFAULT_PROFILES } from '../constants';
import { db } from '../firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where } from 'firebase/firestore';
import { useAuth } from '../components/AuthProvider';

export const useAgentProfiles = () => {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [activeProfile, setActiveProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setProfiles([]);
      setActiveProfile(null);
      setLoading(false);
      return;
    }

    // Set a timeout to force fallback if Firestore hangs
    const timeoutId = setTimeout(() => {
      if (loading) {
        console.warn("Firestore profiles fetch timed out, using fallback.");
        const fallbackProfile = {
          ...DEFAULT_PROFILES[0],
          id: 'fallback-local',
          ownerId: user.uid
        };
        setProfiles([fallbackProfile]);
        setActiveProfileId(fallbackProfile.id);
        setLoading(false);
      }
    }, 5000);

    const q = query(collection(db, 'agents'), where('ownerId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      clearTimeout(timeoutId);
      const fetchedProfiles: AgentProfile[] = [];
      snapshot.forEach((doc) => {
        fetchedProfiles.push(doc.data() as AgentProfile);
      });
      
      if (fetchedProfiles.length === 0) {
        // Create default profile if none exists
        const defaultProfile = {
          ...DEFAULT_PROFILES[0],
          id: `custom-${Date.now()}`,
          ownerId: user.uid
        };
        setDoc(doc(db, 'agents', defaultProfile.id), defaultProfile)
          .then(() => {
            // Success - the next snapshot will catch this
          })
          .catch(error => {
            console.error("Error creating default profile:", error);
            // If we can't create a profile in the DB, let's at least show the default one locally
            // so the app doesn't hang forever
            setProfiles([defaultProfile]);
            setActiveProfileId(defaultProfile.id);
            setLoading(false);
          });
      } else {
        setProfiles(fetchedProfiles);
        if (!activeProfileId || !fetchedProfiles.find(p => p.id === activeProfileId)) {
          setActiveProfileId(fetchedProfiles[0].id);
        }
        setLoading(false);
      }
    }, (error) => {
      clearTimeout(timeoutId);
      console.error("Error fetching profiles:", JSON.stringify({
        error: error.message,
        code: error.code,
        auth: {
            uid: user.uid,
            email: user.email
        },
        query: "agents where ownerId == " + user.uid
      }, null, 2));
      
      // Fallback to a local default profile if the database is unreachable
      const fallbackProfile = {
        ...DEFAULT_PROFILES[0],
        id: 'fallback-local',
        ownerId: user.uid
      };
      setProfiles([fallbackProfile]);
      setActiveProfileId(fallbackProfile.id);
      setLoading(false);
    });

    return () => {
      clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [user, activeProfileId]);

  useEffect(() => {
    const foundProfile = profiles.find(p => p.id === activeProfileId) || profiles[0] || null;
    setActiveProfile(foundProfile);
    if(foundProfile && activeProfileId !== foundProfile.id) {
        setActiveProfileId(foundProfile.id);
    }
  }, [activeProfileId, profiles]);

  const selectProfile = useCallback((id: string) => {
    setActiveProfileId(id);
  }, []);

  const updateProfile = useCallback(async (updatedProfile: AgentProfile) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'agents', updatedProfile.id), updatedProfile);
    } catch (error) {
      console.error("Error updating profile:", error);
    }
  }, [user]);
  
  const createProfile = useCallback(async (name: string) => {
    if (!user) return;
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
        },
        ownerId: user.uid
    };
    try {
      await setDoc(doc(db, 'agents', newProfile.id), newProfile);
      setActiveProfileId(newProfile.id);
    } catch (error) {
      console.error("Error creating profile:", error);
    }
  }, [user]);

  const deleteProfile = useCallback(async (id: string) => {
    if (!user) return;
    if (profiles.length <= 1) {
        alert("You cannot delete the last profile.");
        return;
    }
    try {
      await deleteDoc(doc(db, 'agents', id));
    } catch (error) {
      console.error("Error deleting profile:", error);
    }
  }, [user, profiles]);

  const importProfiles = useCallback(async (newProfiles: AgentProfile[]) => {
      if (!user) return;
      try {
        for (const profile of newProfiles) {
          const profileToSave = { ...profile, ownerId: user.uid };
          await setDoc(doc(db, 'agents', profileToSave.id), profileToSave);
        }
      } catch (error) {
        console.error("Error importing profiles:", error);
      }
  }, [user]);

  return {
    profiles,
    activeProfile,
    selectProfile,
    updateProfile,
    createProfile,
    deleteProfile,
    importProfiles,
    loading
  };
};
