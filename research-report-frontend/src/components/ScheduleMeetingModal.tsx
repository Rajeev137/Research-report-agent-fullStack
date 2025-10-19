import React, { useMemo, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

type Props = {
  visible: boolean;
  onClose: () => void;
  onConfirm: (args: { dateISO: string; timeHHmm: string; attendees: string[]; notes?: string }) => void;
  defaultTitle?: string;     
  defaultAttendees?: string; // comma-separated emails default
};

export default function ScheduleMeetingModal({
  visible,
  onClose,
  onConfirm,
  defaultTitle = 'Sales Brief Follow-up',
  defaultAttendees = '',
}: Props) {
  // ----- state
  const [date, setDate] = useState<Date>(new Date());
  const [time, setTime] = useState<Date>(new Date());
  const [attendeesText, setAttendeesText] = useState<string>(defaultAttendees);
  const [notes, setNotes] = useState<string>('');

  // ----- format helpers
  const dateISO = useMemo(() => {
    const y = date.getFullYear();
    const m = `${date.getMonth() + 1}`.padStart(2, '0');
    const d = `${date.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${d}`; // YYYY-MM-DD
  }, [date]);

  const timeHHmm = useMemo(() => {
    const hh = `${time.getHours()}`.padStart(2, '0');
    const mm = `${time.getMinutes()}`.padStart(2, '0');
    return `${hh}:${mm}`; // HH:mm
  }, [time]);

  function handleConfirm() {
    const attendees = attendeesText
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    onConfirm({ dateISO, timeHHmm, attendees, notes: notes.trim() || undefined });
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        padding: 16
      }}>
        <View style={{
          borderRadius: 16,
          padding: 16,
          backgroundColor: 'rgba(2,6,23,0.92)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.08)'
        }}>
          <Text style={{ color: '#e2e8f0', fontSize: 18, fontWeight: '800', marginBottom: 10 }}>
            Schedule Meeting
          </Text>
          <Text style={{ color: '#94a3b8', marginBottom: 10 }}>
            {defaultTitle}
          </Text>

          {/* Date */}
          <Text style={{ color: '#e2e8f0', fontWeight: '700', marginBottom: 6 }}>Date</Text>
          <View style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 8, marginBottom: 12 }}>
            <DateTimePicker
              value={date}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, selected) => { if (selected) setDate(selected); }}
            />
          </View>

          {/* Time */}
          <Text style={{ color: '#e2e8f0', fontWeight: '700', marginBottom: 6 }}>Time</Text>
          <View style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 8, marginBottom: 12 }}>
            <DateTimePicker
              value={time}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, selected) => { if (selected) setTime(selected); }}
            />
          </View>

          {/* Attendees */}
          <Text style={{ color: '#e2e8f0', fontWeight: '700', marginBottom: 6 }}>Attendees (comma-separated emails)</Text>
          <TextInput
            placeholder="person@example.com, teammate@company.com"
            placeholderTextColor="#64748b"
            value={attendeesText}
            onChangeText={setAttendeesText}
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              color: '#e2e8f0',
              backgroundColor: 'rgba(148,163,184,0.08)',
              borderRadius: 12,
              paddingHorizontal: 12,
              paddingVertical: 10,
              marginBottom: 12
            }}
          />

          {/* Notes (optional) */}
          <Text style={{ color: '#e2e8f0', fontWeight: '700', marginBottom: 6 }}>Notes (optional)</Text>
          <TextInput
            placeholder="Context for the meeting…"
            placeholderTextColor="#64748b"
            value={notes}
            onChangeText={setNotes}
            multiline
            style={{
              color: '#e2e8f0',
              backgroundColor: 'rgba(148,163,184,0.08)',
              borderRadius: 12,
              paddingHorizontal: 12,
              paddingVertical: 10,
              minHeight: 70,
              marginBottom: 16
            }}
          />

          {/* Actions */}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
            <Pressable onPress={onClose} style={{
              paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10,
              backgroundColor: 'rgba(148,163,184,0.15)'
            }}>
              <Text style={{ color: '#e2e8f0', fontWeight: '700' }}>Cancel</Text>
            </Pressable>

            <Pressable onPress={handleConfirm} style={{
              paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10,
              backgroundColor: '#22c55e'
            }}>
              <Text style={{ color: '#052e16', fontWeight: '800' }}>Schedule</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}