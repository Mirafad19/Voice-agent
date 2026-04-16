
import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { Booking, AgentProfile } from '../types';
import { Button } from './ui/Button';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  addMonths, 
  subMonths,
  isToday
} from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Users, Clock, CheckCircle, XCircle } from 'lucide-react';

interface BookingDashboardProps {
  agentProfile: AgentProfile;
}

export const BookingDashboard: React.FC<BookingDashboardProps> = ({ agentProfile }) => {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [view, setView] = useState<'list' | 'calendar'>('calendar');

  useEffect(() => {
    const q = query(
      collection(db, 'bookings'),
      where('agentId', '==', agentProfile.name)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const bookingsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Booking[];
      
      bookingsData.sort((a, b) => new Date(b.bookingDate).getTime() - new Date(a.bookingDate).getTime());
      
      setBookings(bookingsData);
      setLoading(false);
    }, (error) => {
      console.error("Error listening to bookings:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [agentProfile.name]);

  const handleUpdateStatus = async (id: string, newStatus: 'Confirmed' | 'Rejected' | 'Pending') => {
    try {
      await updateDoc(doc(db, 'bookings', id), {
        status: newStatus
      });
    } catch (error) {
      console.error("Error updating status:", error);
    }
  };

  const handleDeleteBooking = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this booking request?")) {
      try {
        await deleteDoc(doc(db, 'bookings', id));
      } catch (error) {
        console.error("Error deleting booking:", error);
      }
    }
  };

  const renderCalendar = () => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);

    const calendarDays = eachDayOfInterval({
      start: startDate,
      end: endDate,
    });

    return (
      <div className="p-4">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-black uppercase tracking-widest text-gray-900 dark:text-white">
            {format(currentMonth, 'MMMM yyyy')}
          </h3>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-px bg-gray-200 dark:bg-gray-700 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="bg-gray-50 dark:bg-gray-800 p-2 text-center text-[10px] font-black uppercase tracking-widest text-gray-400">
              {day}
            </div>
          ))}
          {calendarDays.map((day, idx) => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const dayBookings = bookings.filter(b => b.bookingDate === dateStr && (b.status === 'Confirmed' || b.status === 'Pending'));
            const isBooked = dayBookings.length > 0;
            
            return (
              <div
                key={idx}
                className={`min-h-[100px] p-2 bg-white dark:bg-gray-800 ${
                  !isSameMonth(day, monthStart) ? 'opacity-30' : ''
                } relative`}
              >
                <span className={`text-xs font-bold ${isToday(day) ? 'bg-indigo-600 text-white w-6 h-6 flex items-center justify-center rounded-full' : 'text-gray-500'}`}>
                  {format(day, 'd')}
                </span>
                
                <div className="mt-2 space-y-1">
                  {isBooked ? (
                    <div className="bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 p-1.5 rounded text-[10px] font-bold leading-tight border border-rose-200 dark:border-rose-900/50">
                      <div className="flex items-center gap-1">
                        <XCircle className="h-3 w-3" />
                        UNAVAILABLE
                      </div>
                      {dayBookings.length > 1 && <div className="mt-0.5 text-[8px] opacity-75">{dayBookings.length} Requests</div>}
                    </div>
                  ) : (
                    <div className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 p-1.5 rounded text-[10px] font-bold leading-tight border border-emerald-200 dark:border-emerald-900/50">
                      <div className="flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" />
                        AVAILABLE
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        
        <div className="mt-6 flex gap-6 text-[10px] font-black uppercase tracking-widest text-gray-500">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-emerald-500 rounded-sm"></div>
            <span>Available</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-rose-500 rounded-sm"></div>
            <span>Booked / Fully Occupied</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return <div className="text-gray-500 py-8 text-center">Loading bookings...</div>;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <CalendarIcon className="h-6 w-6 text-indigo-500" />
          PSSDC Booking Manager
        </h2>
        <div className="flex bg-gray-100 dark:bg-gray-900 p-1 rounded-lg">
          <button
            onClick={() => setView('calendar')}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
              view === 'calendar' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500'
            }`}
          >
            Calendar
          </button>
          <button
            onClick={() => setView('list')}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
              view === 'list' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500'
            }`}
          >
            List View
          </button>
        </div>
      </div>

      {view === 'calendar' ? renderCalendar() : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900/50">
                <th className="p-4 text-xs font-black uppercase tracking-widest text-gray-500">Date/Time</th>
                <th className="p-4 text-xs font-black uppercase tracking-widest text-gray-500">Guest Details</th>
                <th className="p-4 text-xs font-black uppercase tracking-widest text-gray-500">Status</th>
                <th className="p-4 text-xs font-black uppercase tracking-widest text-gray-500 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700 text-gray-900 dark:text-gray-100">
              {bookings.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-gray-500">No booking requests found.</td>
                </tr>
              ) : (
                bookings.map((booking) => (
                  <tr key={booking.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <td className="p-4">
                      <div className="font-bold flex items-center gap-2">
                        <Clock className="h-4 w-4 text-gray-400" />
                        {booking.bookingDate}
                      </div>
                      <div className="text-[10px] text-gray-500 uppercase font-black tracking-widest mt-1">
                        {format(new Date(booking.bookingDate), 'EEEE')}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="font-bold uppercase text-xs flex items-center gap-2">
                        <Users className="h-4 w-4 text-indigo-500" />
                        {booking.userName}
                      </div>
                      <div className="text-xs text-gray-500 font-mono mt-1">{booking.userPhone}</div>
                      <div className="text-[10px] text-gray-400 mt-2 italic leading-tight max-w-[240px]">
                        "{booking.purpose}"
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded-sm text-[10px] font-black uppercase tracking-widest ${
                        booking.status === 'Confirmed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30' :
                        booking.status === 'Rejected' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30' :
                        'bg-amber-100 text-amber-700 dark:bg-amber-900/30'
                      }`}>
                        {booking.status}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-2">
                        {booking.status === 'Pending' && (
                          <>
                            <Button size="sm" variant="secondary" onClick={() => handleUpdateStatus(booking.id, 'Confirmed')} className="text-[10px] h-8">Approve</Button>
                            <Button size="sm" variant="danger" onClick={() => handleUpdateStatus(booking.id, 'Rejected')} className="text-[10px] h-8">Reject</Button>
                          </>
                        )}
                        {(booking.status === 'Confirmed' || booking.status === 'Rejected') && (
                          <Button size="sm" variant="secondary" onClick={() => handleUpdateStatus(booking.id, 'Pending')} className="text-[10px] h-8">Reopen</Button>
                        )}
                        <button onClick={() => handleDeleteBooking(booking.id)} className="p-2 text-gray-400 hover:text-rose-500">
                          <XCircle className="h-5 w-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

