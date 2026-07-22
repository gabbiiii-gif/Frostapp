// src/lib/device-policy.js
// Lógica PURA de decisão do status do aparelho. Espelha as regras aplicadas no
// servidor pela edge device-verify — mantida aqui para dar UX no portão do login
// e para ser testável. NÃO é a fronteira de segurança (isso é o RLS, Fase 3).
export function decideDeviceStatus(devices, deviceUuid) {
  const list = Array.isArray(devices) ? devices : [];
  const approved = list.find((d) => d.status === 'approved');
  if (approved) {
    return approved.device_uuid === deviceUuid
      ? { status: 'approved', deviceId: approved.id }
      : { status: 'denied', deviceId: approved.id };
  }
  const thisDevice = list.find((d) => d.device_uuid === deviceUuid);
  if (!thisDevice) return { status: 'needs_enroll', deviceId: null };
  if (thisDevice.status === 'pending') return { status: 'pending', deviceId: thisDevice.id };
  return { status: 'denied', deviceId: thisDevice.id }; // rejected | revoked
}
