import React, { useMemo, useState } from 'react';
import {
  View, Button, Alert, Modal, Platform, Pressable, Text, TextInput, Linking,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useAuth } from '../context/AuthContext';
import { getApiBase } from '../config/apiBase';

const EXPO_PUBLIC_API_BASE_URL = getApiBase();

type Props = { reportId: string; payload: any; };

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }
function toDateISO(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function toTimeHHmm(d: Date) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function isValidDateISO(s: string) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }
function isValidTimeHHmm(s: string) { return /^([01]\d|2[0-3]):([0-5]\d)$/.test(s); }

export default function ActionBar({ reportId, payload }: Props) {
  const base = (EXPO_PUBLIC_API_BASE_URL || '').replace(/\/+$/, '');
  const { user } = useAuth();

  const [showSchedule, setShowSchedule] = useState(false);
  const [dateVal, setDateVal] = useState<Date>(() => new Date());
  const [timeVal, setTimeVal] = useState<Date>(() => {
    const t = new Date(); t.setMinutes(0, 0, 0); t.setHours(t.getHours() + 1); return t;
  });
  const [picking, setPicking] = useState<'date' | 'time' | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // web-editable fields
  const [dateStr, setDateStr] = useState<string>(() => toDateISO(new Date()));
  const [timeStr, setTimeStr] = useState<string>(() => toTimeHHmm(timeVal));

  const [attendeesText, setAttendeesText] = useState<string>(() => user?.email || 'ravtiraman041@gmail.com');
  const [notes, setNotes] = useState<string>('');

  const defaultTitle = useMemo(() => `Meeting: ${payload?.company || payload?.companyName || 'Client'}`, [payload]);

  // ---- helper: open Google auth if token missing ----
  async function connectGoogle() {
    try {
      const url = `${base}/google/auth`;
      const can = await Linking.canOpenURL(url);
      if (!can) { Alert.alert('Error', 'Cannot open Google auth URL'); return; }
      await Linking.openURL(url);
      Alert.alert('Almost done', 'Complete the Google consent in your browser, then tap “Schedule” again.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to open Google auth');
    }
  }

  // ── Email ──────────────────────────────────────────────────────────────────
  async function onSendEmail() {
    try {
      const to = user?.email || 'ravtiraman041@gmail.com';
      const subject = `Intro: ${payload?.company || payload?.companyName || 'Client'}`;
      const html = `
        <h3>${payload?.company || payload?.companyName || 'Client'}</h3>
        <p>${payload?.company_overview || payload?.summary || 'Auto-generated report attached/linked.'}</p>
      `;
      const r = await fetch(`${base}/api/email/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, html, reportId }),
      });
      const text = await r.text().catch(() => '');
      if (!r.ok) throw new Error(text || 'Email send failed');
      Alert.alert('Success', 'Email sent successfully!');
    } catch (e: any) {
      Alert.alert('Email Error', e.message || 'Failed to send email');
    }
  }

  function openSchedule() {
    setShowSchedule(true); setPicking(null);
    setDateStr(toDateISO(dateVal)); setTimeStr(toTimeHHmm(timeVal));
  }

  async function confirmSchedule() {
    try {
      if (!reportId) { Alert.alert('Missing report', 'Cannot schedule without a reportId.'); return; }

      let dateISO = '', timeHHmm = '';
      if (Platform.OS === 'web') {
        if (!isValidDateISO(dateStr)) { Alert.alert('Invalid date', 'Enter date as YYYY-MM-DD'); return; }
        if (!isValidTimeHHmm(timeStr)) { Alert.alert('Invalid time', 'Enter time as HH:mm (24h)'); return; }
        dateISO = dateStr; timeHHmm = timeStr;
      } else {
        dateISO = toDateISO(dateVal); timeHHmm = toTimeHHmm(timeVal);
      }

      const attendees = attendeesText.split(',').map(s => s.trim()).filter(Boolean);
      if (attendees.length === 0) { Alert.alert('Attendees required', 'Add at least one attendee email.'); return; }

      setSubmitting(true);

      const timeZone =
  (Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone) || 'UTC';

      const payloadOut = { reportId, title: defaultTitle, dateISO, timeHHmm, attendees, timeZone,  };

      const r = await fetch(`${base}/api/calendar/schedule`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadOut),
      });

      const bodyText = await r.text().catch(() => '');

      if (!r.ok) {
        // try to parse JSON so we can branch on “Google token missing”
        let errJson: any = null;
        try { errJson = JSON.parse(bodyText); } catch {}
        const details = errJson?.details || bodyText;

        // Special handling for missing token
        if (String(details).toLowerCase().includes('google token') || String(details).includes('/google/auth')) {
          Alert.alert(
            'Connect Google',
            'This server needs access to your Google Calendar. Connect now, then come back and tap “Schedule” again.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Connect', onPress: connectGoogle },
            ]
          );
          return;
        }

        throw new Error(details || `Calendar create failed (status ${r.status})`);
      }

      setShowSchedule(false);
      Alert.alert('Calendar', `Event created for ${dateISO} at ${timeHHmm}.`);
    } catch (e: any) {
      Alert.alert('Calendar Error', e.message || 'Failed to create calendar event');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title="Send Email" onPress={onSendEmail} />
        <Button title="Schedule Meeting" onPress={openSchedule} />
      </View>

      <Modal visible={showSchedule} transparent animationType="slide" onRequestClose={() => setShowSchedule(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
          <View style={{ width: '100%', maxWidth: 420, backgroundColor: '#0b1220', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
            <Text style={{ color: '#e2e8f0', fontSize: 18, fontWeight: '800', marginBottom: 8 }}>Schedule Meeting</Text>
            <Text style={{ color: '#94a3b8', marginBottom: 12 }}>Event: {defaultTitle}</Text>

            <Text style={{ color: '#e2e8f0', fontWeight: '700', marginBottom: 6 }}>Pick Date</Text>
            {(Platform.OS === 'ios' || Platform.OS === 'android') ? (
              <DateTimePicker mode="date" value={dateVal} onChange={(_, d) => d && setDateVal(d)} />
            ) : (
              <TextInput
                placeholder="YYYY-MM-DD" placeholderTextColor="#64748b"
                value={dateStr} onChangeText={setDateStr} autoCapitalize="none" autoCorrect={false}
                style={{ color: '#e2e8f0', backgroundColor: 'rgba(148,163,184,0.08)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 }}
              />
            )}

            <Text style={{ color: '#e2e8f0', fontWeight: '700', marginBottom: 6 }}>Pick Time</Text>
            {(Platform.OS === 'ios' || Platform.OS === 'android') ? (
              <DateTimePicker mode="time" value={timeVal} onChange={(_, d) => d && setTimeVal(d)} />
            ) : (
              <TextInput
                placeholder="HH:mm" placeholderTextColor="#64748b"
                value={timeStr} onChangeText={setTimeStr} autoCapitalize="none" autoCorrect={false}
                style={{ color: '#e2e8f0', backgroundColor: 'rgba(148,163,184,0.08)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16 }}
              />
            )}

            {/* Android picker popup preserved */}
            {picking && Platform.OS === 'android' ? (
              <DateTimePicker
                mode={picking}
                value={picking === 'date' ? dateVal : timeVal}
                onChange={(_, d) => { if (d) { picking === 'date' ? setDateVal(d) : setTimeVal(d); } setPicking(null); }}
              />
            ) : null}

            <Text style={{ color: '#e2e8f0', fontWeight: '700', marginBottom: 6 }}>Attendees (comma-separated emails)</Text>
            <TextInput
              placeholder="teammate@company.com, client@example.com" placeholderTextColor="#64748b"
              value={attendeesText} onChangeText={setAttendeesText} autoCapitalize="none" autoCorrect={false}
              style={{ color: '#e2e8f0', backgroundColor: 'rgba(148,163,184,0.08)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 }}
            />

            <Text style={{ color: '#e2e8f0', fontWeight: '700', marginBottom: 6 }}>Notes (optional)</Text>
            <TextInput
              placeholder="Context for the meeting…" placeholderTextColor="#64748b"
              value={notes} onChangeText={setNotes} multiline
              style={{ color: '#e2e8f0', backgroundColor: 'rgba(148,163,184,0.08)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, minHeight: 70, marginBottom: 16 }}
            />

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
              <Button title="Cancel" onPress={() => setShowSchedule(false)} />
              <Button title={submitting ? 'Scheduling…' : 'Schedule'} onPress={confirmSchedule} disabled={submitting} />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}