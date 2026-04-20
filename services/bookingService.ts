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
  // User requested to allow multiple bookings per day as management handles the review.
  // We return true (available) for any booking request to keep the AI flow smooth.
  return true;
};

export const createBooking = async (booking: Omit<Booking, 'id' | 'createdAt' | 'status'>): Promise<string> => {
  try {
    // Basic guard to prevent accidental double-clicks (within 10 seconds)
    const q = query(
      collection(db, BOOKINGS_COLLECTION),
      where('agentId', '==', booking.agentId),
      where('userPhone', '==', booking.userPhone),
      where('bookingDate', '==', booking.bookingDate),
      where('purpose', '==', booking.purpose),
      where('status', '==', 'Pending')
    );
    
    const existing = await getDocs(q);
    if (!existing.empty) {
      const veryRecent = existing.docs.find(doc => {
        const data = doc.data();
        const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : null;
        // If it was created within the last 10 seconds, consider it a double-click
        return createdAt && createdAt.getTime() > (Date.now() - 10000);
      });
      
      if (veryRecent) {
        console.log("Blocking accidental double-click. Returning existing ID:", veryRecent.id);
        return veryRecent.id;
      }
    }

    console.log(`[BOOKING_ATTEMPT] agentId: ${booking.agentId}, userPhone: ${booking.userPhone}, date: ${booking.bookingDate}`);
    const docRef = await addDoc(collection(db, BOOKINGS_COLLECTION), {
      ...booking,
      status: 'Pending',
      createdAt: serverTimestamp()
    });
    
    console.log(`[BOOKING_SUCCESS] Created booking ${docRef.id} for agentId: ${booking.agentId}`);
    return docRef.id;
  } catch (error) {
    console.error("[BOOKING_ERROR] Failed to create booking:", error);
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
