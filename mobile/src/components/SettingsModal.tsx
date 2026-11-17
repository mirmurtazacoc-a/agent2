import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { config } from '../config';

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ visible, onClose }) => {
  const [url, setUrl] = useState(config.getApiUrl());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);

    let testUrl = url.trim().replace(/\/+$/, '');
    if (!testUrl.startsWith('http://') && !testUrl.startsWith('https://')) {
      testUrl = 'http://' + testUrl;
    }

    try {
      const res = await fetch(`${testUrl}/api/status`, { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        setTestResult(`✅ Connected! Mode: ${data.systemMode || 'ONLINE'}`);
      } else {
        setTestResult(`⚠️ Server responded with HTTP ${res.status}`);
      }
    } catch (err: any) {
      setTestResult(`❌ Connection Failed: ${err.message}`);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    config.setBackendUrl(url);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>⚙️ Backend Server Settings</Text>
          <Text style={styles.subtitle}>
            Enter the IP address of the PC running the QuantumEdge backend server.
          </Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Server Base URL:</Text>
            <TextInput
              style={styles.input}
              value={url}
              onChangeText={setUrl}
              placeholder="e.g. http://192.168.1.100:3000"
              placeholderTextColor="#64748b"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* Preset shortcuts */}
          <View style={styles.presetsRow}>
            <TouchableOpacity
              onPress={() => setUrl('http://localhost:3000')}
              style={styles.presetBtn}
            >
              <Text style={styles.presetText}>Localhost</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setUrl('http://10.0.2.2:3000')}
              style={styles.presetBtn}
            >
              <Text style={styles.presetText}>Android Emul</Text>
            </TouchableOpacity>
          </View>

          {/* Test Status feedback */}
          {testing && <ActivityIndicator color="#3b82f6" style={{ marginVertical: 8 }} />}
          {testResult && (
            <Text style={[styles.resultText, testResult.startsWith('✅') ? styles.resultSuccess : styles.resultError]}>
              {testResult}
            </Text>
          )}

          {/* Action buttons */}
          <View style={styles.buttonRow}>
            <TouchableOpacity
              onPress={testConnection}
              disabled={testing}
              style={[styles.btn, styles.testBtn]}
            >
              <Text style={styles.testBtnText}>Test Ping</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSave}
              style={[styles.btn, styles.saveBtn]}
            >
              <Text style={styles.saveBtnText}>Save & Connect</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 20,
  },
  modal: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 14,
    padding: 18,
    gap: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ffffff',
    fontFamily: 'monospace',
  },
  subtitle: {
    fontSize: 11,
    color: '#94a3b8',
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  inputGroup: {
    gap: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#cbd5e1',
    fontFamily: 'monospace',
  },
  input: {
    backgroundColor: '#080c14',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#ffffff',
    fontSize: 13,
    fontFamily: 'monospace',
  },
  presetsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  presetBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 5,
  },
  presetText: {
    color: '#94a3b8',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  resultText: {
    fontSize: 11,
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  resultSuccess: {
    color: '#34d399',
  },
  resultError: {
    color: '#fb7185',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  btn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  testBtn: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  testBtnText: {
    color: '#60a5fa',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  saveBtn: {
    backgroundColor: '#2563eb',
  },
  saveBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  closeBtn: {
    alignItems: 'center',
    paddingTop: 4,
  },
  closeBtnText: {
    color: '#64748b',
    fontSize: 12,
    fontFamily: 'monospace',
  },
});

