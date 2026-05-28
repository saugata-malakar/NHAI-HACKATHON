/**
 * BulkEnrollScreen — CSV pre-registration importer.
 * CSV format: employee_id,full_name,department,designation
 * Creates inactive user records. Face capture activates them.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Alert,
} from 'react-native';
import DocumentPicker from 'react-native-document-picker';
import { v4 as uuidv4 } from 'uuid';
import { FaceDB } from '../storage/FaceDB';
import { EdgeLogger } from '../utils/EdgeLogger';

interface ParsedRow {
  employeeId: string; fullName: string; department: string; designation: string; ok: boolean; error?: string;
}

export default function BulkEnrollScreen() {
  const [rows, setRows]     = useState<ParsedRow[]>([]);
  const [status, setStatus] = useState<'idle' | 'parsed' | 'importing' | 'done'>('idle');
  const [imported, setImported] = useState(0);

  const pickCSV = async () => {
    try {
      const res = await DocumentPicker.pickSingle({ type: [DocumentPicker.types.plainText, DocumentPicker.types.csv] });
      const text = await (await fetch(res.uri)).text();
      parseCSV(text);
    } catch (e: any) {
      if (!DocumentPicker.isCancel(e)) Alert.alert('Error', e.message);
    }
  };

  const parseCSV = (text: string) => {
    const lines = text.trim().split('\n');
    const header = lines[0].toLowerCase();
    const startIdx = header.includes('employee') ? 1 : 0;
    const parsed: ParsedRow[] = lines.slice(startIdx).map(line => {
      const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''));
      if (parts.length < 2) return { employeeId: '', fullName: '', department: '', designation: '', ok: false, error: 'Too few columns' };
      const [employeeId, fullName, department = '', designation = ''] = parts;
      if (!employeeId || !fullName) return { employeeId, fullName, department, designation, ok: false, error: 'Missing required fields' };
      return { employeeId, fullName, department, designation, ok: true };
    });
    setRows(parsed);
    setStatus('parsed');
  };

  const doImport = async () => {
    setStatus('importing');
    const valid = rows.filter(r => r.ok);
    let count = 0;
    for (const row of valid) {
      try {
        await FaceDB.upsertUser({
          id: uuidv4(), fullName: row.fullName, employeeId: row.employeeId,
          department: row.department, designation: row.designation,
          enrolledAt: Date.now(), active: false, // inactive until face enrolled
        });
        count++;
      } catch (e: any) {
        EdgeLogger.error(`[BulkEnroll] ${row.employeeId}: ${e.message}`);
      }
    }
    setImported(count);
    setStatus('done');
    EdgeLogger.info(`[BulkEnroll] Imported ${count} of ${valid.length} users`);
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <View style={s.infoCard}>
        <Text style={s.infoTitle}>CSV Bulk Pre-Registration</Text>
        <Text style={s.infoBody}>
          Upload a CSV file to pre-register users before face capture.{'\n'}
          Users will be created as <Text style={{ color: '#FF6D00' }}>Inactive</Text> until a face is enrolled for them.
        </Text>
        <Text style={s.format}>Expected columns (header row optional):{'\n'}employee_id, full_name, department, designation</Text>
      </View>

      <TouchableOpacity style={s.pickBtn} onPress={pickCSV}>
        <Text style={s.pickBtnText}>📂  Pick CSV File</Text>
      </TouchableOpacity>

      {rows.length > 0 && (
        <>
          <View style={s.summaryRow}>
            <View style={s.summaryCard}>
              <Text style={[s.summaryNum, { color: '#00E676' }]}>{rows.filter(r => r.ok).length}</Text>
              <Text style={s.summaryLabel}>Valid</Text>
            </View>
            <View style={s.summaryCard}>
              <Text style={[s.summaryNum, { color: '#EF5350' }]}>{rows.filter(r => !r.ok).length}</Text>
              <Text style={s.summaryLabel}>Errors</Text>
            </View>
            <View style={s.summaryCard}>
              <Text style={[s.summaryNum, { color: '#00E5FF' }]}>{rows.length}</Text>
              <Text style={s.summaryLabel}>Total</Text>
            </View>
          </View>

          {/* Preview table */}
          <View style={s.tableHeader}>
            {['ID','Name','Dept','Status'].map(h => (
              <Text key={h} style={s.tableHeaderCell}>{h}</Text>
            ))}
          </View>
          {rows.slice(0, 20).map((row, i) => (
            <View key={i} style={[s.tableRow, !row.ok && s.tableRowError]}>
              <Text style={s.cell} numberOfLines={1}>{row.employeeId || '—'}</Text>
              <Text style={s.cell} numberOfLines={1}>{row.fullName || '—'}</Text>
              <Text style={s.cell} numberOfLines={1}>{row.department || '—'}</Text>
              <Text style={[s.cell, { color: row.ok ? '#00E676' : '#EF5350' }]}>{row.ok ? '✓' : '✗'}</Text>
            </View>
          ))}
          {rows.length > 20 && <Text style={s.moreText}>+{rows.length - 20} more rows…</Text>}

          {status !== 'done' && (
            <TouchableOpacity
              style={[s.importBtn, status === 'importing' && s.importBtnDisabled]}
              onPress={doImport}
              disabled={status === 'importing'}>
              <Text style={s.importBtnText}>
                {status === 'importing' ? 'Importing…' : `Import ${rows.filter(r => r.ok).length} Users`}
              </Text>
            </TouchableOpacity>
          )}

          {status === 'done' && (
            <View style={s.successCard}>
              <Text style={s.successText}>✓  {imported} users imported successfully</Text>
              <Text style={s.successSub}>Go to User Registry to assign faces via face enrollment.</Text>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1B2A' },
  infoCard: { backgroundColor: '#112233', borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#1E3A5F' },
  infoTitle: { color: '#00E5FF', fontWeight: '700', fontSize: 16, marginBottom: 8 },
  infoBody: { color: '#78909C', fontSize: 13, lineHeight: 20, marginBottom: 10 },
  format: { color: '#546E7A', fontSize: 11, fontFamily: 'monospace', backgroundColor: '#0A1929', padding: 10, borderRadius: 8 },
  pickBtn: { backgroundColor: '#1565C0', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 16 },
  pickBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  summaryCard: { flex: 1, backgroundColor: '#112233', borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#1E3A5F' },
  summaryNum: { fontSize: 26, fontWeight: '800' },
  summaryLabel: { fontSize: 11, color: '#546E7A', marginTop: 2 },
  tableHeader: { flexDirection: 'row', backgroundColor: '#0A1929', padding: 10, borderRadius: 8, marginBottom: 4 },
  tableHeaderCell: { flex: 1, color: '#00E5FF', fontSize: 11, fontWeight: '700' },
  tableRow: { flexDirection: 'row', backgroundColor: '#112233', padding: 10, borderRadius: 6, marginBottom: 3, borderWidth: 1, borderColor: '#1E3A5F' },
  tableRowError: { borderColor: '#4A0000', backgroundColor: '#1A0000' },
  cell: { flex: 1, color: '#B0BEC5', fontSize: 11 },
  moreText: { color: '#546E7A', fontSize: 12, textAlign: 'center', marginTop: 4, marginBottom: 8 },
  importBtn: { backgroundColor: '#00BCD4', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 12 },
  importBtnDisabled: { opacity: 0.5 },
  importBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  successCard: { backgroundColor: '#0A2E1A', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#00E676', marginTop: 12, alignItems: 'center' },
  successText: { color: '#00E676', fontWeight: '700', fontSize: 16 },
  successSub: { color: '#78909C', fontSize: 12, marginTop: 6, textAlign: 'center' },
});
