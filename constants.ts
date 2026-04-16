
import { AgentProfile, AgentVoice, AccentColor, WidgetTheme } from './types';

const defaultEmailConfig = {
  formspreeEndpoint: '',
};

const defaultFileUploadConfig = {
  cloudinaryCloudName: '',
  cloudinaryUploadPreset: '',
};

export const DEFAULT_PROFILES: AgentProfile[] = [
  {
    id: 'pssdc-assistant',
    name: 'Babajide (PSSDC)',
    knowledgeBase: `# ============================================================
# P-S-S-D-C AI VOICE ASSISTANT — COMPLETE KNOWLEDGE BASE
# ============================================================
The Public Service Staff Development Centre (P-S-S-D-C) is the official capacity-building institution of the Lagos State Public Service.
- Established in 1994 under Lagos State Edict No. 9.
- Mandated to train, retrain, and continuously develop government employees across Lagos State.

Vision: To be Africa’s leading public-service capacity-building institution with a world-class reputation.
Mission: To provide human capacity development solutions through learning, research, innovation, and technology-driven resources.

TRAINING PROGRAMMES:
1. Business Skills (strategic planning, communication)
2. Finance and Economic Development (public finance, budgeting)
3. Health and Allied Programmes
4. Human Resource Management
5. ICT Studies (digital skills, cybersecurity)
6. Local Government and Security Studies
7. Metropolitan Development
8. Modern Public Administration and Management
9. Public Sector Governance
10. Teacher Education and Development

SERVICES:
- Learning & Development
- Management Consultancy (organisational development, performance improvement)
- Research & Publications
- Facility Hire: Executive training halls, classrooms, and a 52-bed guest lodge with an on-site cafeteria.

LODGE DETAILS:
- 52-bed guest lodge
- 12 single rooms, 6 double rooms, 2 dormitories (8 beds each)
- On-site cafeteria

LEADERSHIP:
- Director-General: Adio-Moses Adekunmilola Toluwase
- Director of Programmes: Sholaja Kolawole Olufemi
- Director of Admin & HR: Sofowora Mojisola Jolade

CONTACT:
- Address: 5–39 P-S-S-D-C Road, Magodo GRA Phase 2, Lagos
- Phone: +234 915 265 0704
- Email: info@pssdc.ng

COMPLAINTS:
- We welcome feedback. I will listen fully and prepare a report for our human officers. I will never argue and will always respond with empathy.`,
    
    chatKnowledgeBase: `# ============================================================
# P-S-S-D-C AI CHAT ASSISTANT — COMPLETE KNOWLEDGE BASE
# ============================================================
I am Babajide, the official AI assistant for PSSDC Lagos. 

CORE SERVICES:
1. Learning & Development
2. Management Consultancy
3. Research & Publications
4. Facility Hire (Training halls, 52-bed guest lodge)

PROGRAMMES:
We offer training in Business Skills, Finance, Health, HR, ICT, Local Government, Metropolitan Development, Modern Public Administration, Governance, and Teacher Education.

FACILITY BOOKING:
I can help you check availability and book our Guest Lodge. The lodge has single rooms, double rooms, and dormitories.

CONTACT:
Address: 5–39 P-S-S-D-C Road, Magodo GRA Phase 2, Lagos
Phone: +234 915 265 0704
Email: info@pssdc.ng`,
    
    theme: WidgetTheme.Light,
    voice: AgentVoice.Zephyr,
    accentColor: AccentColor.Teal,
    calloutMessage: 'Hello Lagos! I am Babajide from PSSDC. How can I assist you today?',
    logoUrl: 'https://pssdc.lagosstate.gov.ng/wp-content/uploads/sites/68/2021/04/PSSDC-Logo.png',
    avatar1Url: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=128',
    avatar2Url: '',
    
    initialGreeting: 'Hello, I am Babajide from PSSDC Lagos. How can I help you today?',
    initialGreetingText: 'Hello! 👋 I am Babajide, your PSSDC Lagos assistant. How can I help you today?',
    
    emailConfig: defaultEmailConfig,
    fileUploadConfig: defaultFileUploadConfig,
    maxLodgeCapacity: 52
  },
];
