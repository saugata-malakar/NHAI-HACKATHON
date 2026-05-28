import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Switch, Alert, ActivityIndicator, KeyboardAvoidingView, Platform
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { FaceDB } from '../storage/FaceDB';
import { useAdminAuth } from '../utils/useAdminAuth';
import { v4 as uuidv4 } from 'uuid';

export default function BulkEnrollScreen() {
  useAdminAuth();
  const nav = useNavigation();

  const [csvText, setCsvText] = useState('');
  const [setActiveOnImport, setSetActiveOnImport] = useState(false);
  const [loading, setLoading] = useState(false);
  const [previewRecords, setPreviewRecords] = useState<any[]>([]);

  const handleParseCsv = () => {
    if (!csvText.trim()) {
      Alert.alert('Empty Input', 'Please paste or enter CSV text first.');
      return;
    }

    const lines = csvText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) {
      Alert.alert('Empty Input', 'No valid rows found in the input.');
      return;
    }

    // Attempt to detect and parse headers
    let firstLine = lines[0];
    const hasHeader = firstLine.toLowerCase().includes('name') || firstLine.toLowerCase().includes('id');
    const dataLines = hasHeader ? lines.slice(1) : lines;

    const parsed: any[] = [];
    for (const line of dataLines) {
      const parts = line.split(',').map(p => p.trim());
      if (parts.length < 2) continue; // Must have at least name and employee_id

      parsed.push({
        fullName: parts[0],
        employeeId: parts[1],
        department: parts[2] || '',
        designation: parts[3] || '',
      });
    }

    if (parsed.length === 0) {
      Alert.alert('Parsing Error', 'Could not parse any valid records. Use format: Name, EmployeeID, [Department], [Designation]');
      return;
    }

    setPreviewRecords(parsed);
  };

  const handleImport = async () => {
    if (previewRecords.length === 0) {
      Alert.alert('No Preview Records', 'Please parse the CSV input and verify the preview records first.');
      return;
    }

    setLoading(true);
    let successCount = 0;
    try {
      for (const rec of previewRecords) {
        // Pre-create the registry entry in users
        const id = uuidv4();
        await FaceDB.createUser({
          id,
          fullName: rec.fullName,
          employeeId: rec.employeeId,
          department: rec.department,
          designation: rec.designation,
        });

        // Set status based on administrative toggle
        await FaceDB.updateUserStatus(id, setActiveOnImport);
        successCount++;
      }

      Alert.alert(
        'Import Successful',
        `Pre-registered ${successCount} personnel records in the local registry database. Status is set to: ${
          setActiveOnImport ? 'ACTIVE (Bypasses onboarding constraints)' : 'PENDING BIOMETRIC ONBOARDING (Suspended until face is captured)'
        }`,
        [{ text: 'OK', onPress: () => nav.goBack() }]
      );
    } catch (err) {
      console.error('[BulkEnrollScreen] Error during import:', err);
      Alert.alert('Import Failed', 'An error occurred while writing records to SQLite DB.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>👥 Dynamic Bulk CSV Enrollment</Text>
          <Text style={styles.cardDescription}>
            Quickly ingest field personnel names and IDs into the offline registry. After importing, personnel can step up to the front camera to link their face embeddings.
          </Text>

          <Text style={styles.fieldLabel}>CSV Data Input</Text>
          <TextInput
            multiline
            numberOfLines={8}
            style={styles.textArea}
            placeholder="Jane Doe, EMP102, Logistics, Field Supervisor&#10;John Smith, EMP103, Operations, Drill Operator"
            placeholderTextColor="#546E7A"
            value={csvText}
            onChangeText={setCsvText}
          />
          <Text style={styles.formatTip}>
            Expected CSV Format (no quotes): <Text style={styles.codeText}>Name, EmployeeID, [Department], [Designation]</Text>
          </Text>

          <TouchableOpacity style={styles.btnSecondary} onPress={handleParseCsv}>
            <Text style={styles.btnSecondaryText}>🔍 Parse & Validate CSV</Text>
          </TouchableOpacity>
        </View>

        {/* Options card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Import Settings</Text>
          <View style={styles.controlRow}>
            <View style={styles.controlInfo}>
              <Text style={styles.controlLabel}>Immediately Activate Accounts</Text>
              <Text style={styles.controlDescription}>
                If disabled, imported accounts are registered as Suspended/Pending until their face biometric template is enrolled.
              </Text>
            </View>
            <Switch
              value={setActiveOnImport}
              onValueChange={setSetActiveOnImport}
              thumbColor={setActiveOnImport ? '#00E5FF' : '#78909C'}
              trackColor={{ false: '#263238', true: '#1E3A5F' }}
            />
          </View>
        </View>

        {/* Preview Section */}
        {previewRecords.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Preview Parsed Records ({previewRecords.length})</Text>
            
            <View style={styles.previewContainer}>
              {previewRecords.map((rec, i) => (
                <View key={i} style={styles.previewItem}>
                  <Text style={styles.previewName}>{rec.fullName}</Text>
                  <Text style={styles.previewMeta}>
                    ID: {rec.employeeId} • {rec.department || 'No Dept'} • {rec.designation || 'No Title'}
                  </Text>
                </View>
              ))}
            </View>

            {loading ? (
              <ActivityIndicator size="small" color="#00E5FF" style={styles.loader} />
            ) : (
              <TouchableOpacity style={styles.btnPrimary} onPress={handleImport}>
                <Text style={styles.btnPrimaryText}>🚀 Ingest Records to SQLite</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1B2A' },
  content: { padding: 20, paddingBottom: 40 },
  card: {
    backgroundColor: '#112233',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    padding: 20,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#00E5FF',
    marginBottom: 10,
  },
  cardDescription: {
    fontSize: 13,
    color: '#B0BEC5',
    lineHeight: 18,
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E0F7FA',
    marginBottom: 8,
  },
  textArea: {
    backgroundColor: '#0D1B2A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    color: '#E0F7FA',
    padding: 12,
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    textAlignVertical: 'top',
    height: 120,
    marginBottom: 8,
  },
  formatTip: {
    fontSize: 11,
    color: '#78909C',
    marginBottom: 16,
  },
  codeText: {
    color: '#00E5FF',
  },
  btnSecondary: {
    borderWidth: 1,
    borderColor: '#00E5FF',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: 'rgba(0, 229, 255, 0.05)',
  },
  btnSecondaryText: {
    color: '#00E5FF',
    fontWeight: '700',
    fontSize: 14,
  },
  controlRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  controlInfo: {
    flex: 1,
    marginRight: 16,
  },
  controlLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E0F7FA',
    marginBottom: 4,
  },
  controlDescription: {
    fontSize: 12,
    color: '#B0BEC5',
  },
  previewContainer: {
    backgroundColor: '#0D1B2A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    maxHeight: 200,
    marginBottom: 16,
    padding: 8,
  },
  previewItem: {
    borderBottomWidth: 1,
    borderBottomColor: '#1E3A5F',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  previewName: {
    color: '#E0F7FA',
    fontSize: 14,
    fontWeight: '700',
  },
  previewMeta: {
    color: '#78909C',
    fontSize: 11,
    marginTop: 2,
  },
  btnPrimary: {
    backgroundColor: '#00BCD4',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  loader: {
    marginVertical: 12,
  },
});
