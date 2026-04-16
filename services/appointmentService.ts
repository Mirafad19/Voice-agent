import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { db } from '../firebase';
import { Appointment } from '../types';

const APPOINTMENTS_COLLECTION = 'appointments';

export const checkAvailability = async (agentId: string, date: string, time: string): Promise<boolean> => {
  try {
    const q = query(
      collection(db, APPOINTMENTS_COLLECTION),
      where('agentId', '==', agentId),
      where('date', '==', date),
      where('time', '==', time),
      where('status', '==', 'booked')
    );
    
    const querySnapshot = await getDocs(q);
    return querySnapshot.empty;
  } catch (error) {
    console.error("Error checking availability:", error);
    throw error;
  }
};

export const bookAppointment = async (appointment: Omit<Appointment, 'id' | 'createdAt' | 'status'>): Promise<string> => {
  try {
    const isAvailable = await checkAvailability(appointment.agentId, appointment.date, appointment.time);
    
    if (!isAvailable) {
      throw new Error("This slot is already booked.");
    }

    const docRef = await addDoc(collection(db, APPOINTMENTS_COLLECTION), {
      ...appointment,
      status: 'booked',
      createdAt: serverTimestamp()
    });
    
    return docRef.id;
  } catch (error) {
    console.error("Error booking appointment:", error);
    throw error;
  }
};

export const getAppointmentsForDate = async (agentId: string, date: string): Promise<Appointment[]> => {
  try {
    const q = query(
      collection(db, APPOINTMENTS_COLLECTION),
      where('agentId', '==', agentId),
      where('date', '==', date),
      where('status', '==', 'booked')
    );
    
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as Appointment));
  } catch (error) {
    console.error("Error fetching appointments:", error);
    throw error;
  }
};
