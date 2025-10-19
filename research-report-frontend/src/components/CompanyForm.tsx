import React, { useState } from 'react';
import { View, Text, TextInput, Switch, Pressable } from 'react-native';

export default function CompanyForm({
  onSubmit,
  loading
}: {
  onSubmit: (v: { companyName: string; domain?: string; force: boolean }) => void;
  loading: boolean;
}) {
  const [companyName, setCompanyName] = useState('');
  const [domain, setDomain] = useState('');
  const [force, setForce] = useState(true);

  const canSubmit = !loading && companyName.trim().length > 0;

  return (
    <View style={{
      gap: 12,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.08)',
      backgroundColor: 'rgba(2,6,23,0.6)',
      padding: 16,
      borderRadius: 16
    }}>
      <Text style={{ color: '#e2e8f0', fontWeight: '700', fontSize: 16 }}>Generate Sales Brief</Text>

      <View>
        <Text style={{ color: '#94a3b8', marginBottom: 6 }}>Company Name *</Text>
        <TextInput
          placeholder="e.g. YouTube"
          placeholderTextColor="#64748b"
          value={companyName}
          onChangeText={setCompanyName}
          style={{
            backgroundColor: '#0b2538',
            color: '#e2e8f0',
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderWidth: 1,
            borderColor: '#16344a'
          }}
        />
      </View>

      <View>
        <Text style={{ color: '#94a3b8', marginBottom: 6 }}>Domain (optional)</Text>
        <TextInput
          placeholder="e.g. youtube.com"
          placeholderTextColor="#64748b"
          value={domain}
          onChangeText={setDomain}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            backgroundColor: '#0b2538',
            color: '#e2e8f0',
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderWidth: 1,
            borderColor: '#16344a'
          }}
        />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: '#cbd5e1' }}>Force new run</Text>
        <Switch value={force} onValueChange={setForce} />
      </View>

      <Pressable
        disabled={!canSubmit}
        onPress={() => onSubmit({ companyName: companyName.trim(), domain: domain.trim() || undefined, force })}
        style={{
          opacity: canSubmit ? 1 : 0.6,
          backgroundColor: '#14b8a6',
          paddingVertical: 12,
          borderRadius: 10,
          alignItems: 'center'
        }}
      >
        <Text style={{ color: '#05333a', fontWeight: '700' }}>
          {loading ? 'Working…' : 'Generate Report'}
        </Text>
      </Pressable>
    </View>
  );
}