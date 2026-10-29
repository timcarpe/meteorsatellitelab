/** Published Secondary bell times. These do not describe lab bookings. */
export interface BellPeriod {
  readonly id: string;
  readonly label: string;
  readonly from: string;
  readonly until: string;
  readonly kind: 'break' | 'lesson';
}
export const TIMETABLE_SOURCE = 'https://vas-lab-booking.netlify.app/';
export const BELL_PERIODS: readonly BellPeriod[] = Object.freeze(
  [
    { id: 'p1', label: 'Period 1', from: '07:30', until: '08:15', kind: 'lesson' },
    { id: 'p2', label: 'Period 2', from: '08:15', until: '09:00', kind: 'lesson' },
    { id: 'p3', label: 'Period 3', from: '09:00', until: '09:45', kind: 'lesson' },
    {
      id: 'break1',
      label: 'Morning break',
      from: '09:45',
      until: '10:00',
      kind: 'break',
    },
    { id: 'p4', label: 'Period 4', from: '10:00', until: '10:45', kind: 'lesson' },
    { id: 'p5', label: 'Period 5', from: '10:45', until: '11:30', kind: 'lesson' },
    { id: 'lunch', label: 'Lunch', from: '11:30', until: '13:00', kind: 'break' },
    { id: 'p6', label: 'Period 6', from: '13:00', until: '13:45', kind: 'lesson' },
    { id: 'p7', label: 'Period 7', from: '13:45', until: '14:30', kind: 'lesson' },
    {
      id: 'break2',
      label: 'Afternoon break',
      from: '14:30',
      until: '15:00',
      kind: 'break',
    },
    { id: 'p8', label: 'Period 8', from: '15:00', until: '15:45', kind: 'lesson' },
    { id: 'eca', label: 'ECA', from: '15:45', until: '16:30', kind: 'lesson' },
  ].map((value) => Object.freeze(value as BellPeriod)),
);
