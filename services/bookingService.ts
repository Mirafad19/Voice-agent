import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Booking } from '../types';

const BOOKINGS_COLLECTION = 'bookings';

export const checkFacilityAvailability = async (agentId: string, date: string): Promise<boolean> => {
  try {
    const q = query(
      collection(db, BOOKINGS_COLLECTION),
      where('agentId', '==', agentId),
      where('bookingDate', '==', date),
      where('status', 'in', ['Pending', 'Confirmed'])
    );
    
    const querySnapshot = await getDocs(q);
    // For now, as per user request: "make it red when it is booked or multiple booked it"
    // We'll return false (unavailable) if there's any pending or confirmed booking on that date.
    return querySnapshot.empty;
  } catch (error) {
    console.error("Error checking availability:", error);
    throw error;
  }
};

export const createBooking = async (booking: Omit<Booking, 'id' | 'createdAt' | 'status'>): Promise<string> => {
  try {
    const isAvailable = await checkFacilityAvailability(booking.agentId, booking.bookingDate);
    
    if (!isAvailable) {
      throw new Error("This date is already booked or full.");
    }

    const docRef = await addDoc(collection(db, BOOKINGS_COLLECTION), {
      ...booking,
      status: 'Pending',
      createdAt: serverTimestamp()
    });
    
    return docRef.id;
  } catch (error) {
    console.error("Error creating booking:", error);
    throw error;
  }
};

export const getBookingsForAgent = async (agentId: string): Promise<Booking[]> => {
  try {
    const q = query(
      collection(db, BOOKINGS_COLLECTION),
      where('agentId', '==', agentId)
    );
    
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as Booking));
  } catch (error) {
    console.error("Error fetching bookings:", error);
    throw error;
  }
};
