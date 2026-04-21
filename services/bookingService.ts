import { Booking } from '../types';

export const checkFacilityAvailability = async (agentId: string, date: string): Promise<boolean> => {
  return true;
};

export const createBooking = async (booking: Omit<Booking, 'id' | 'createdAt' | 'status'>): Promise<string> => {
  try {
    const response = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking)
    });
    const result = await response.json();
    return result.bookingId;
  } catch (error) {
    console.error("[BOOKING_ERROR] Failed to create booking:", error);
    throw error;
  }
};

export const getBookingsForAgent = async (agentId: string): Promise<Booking[]> => {
  try {
    const response = await fetch(`/api/bookings?agentId=${agentId}`);
    return await response.json();
  } catch (error) {
    console.error("Error fetching bookings:", error);
    throw error;
  }
};
