import { useState, forwardRef } from 'react';
import { validatePasswordStrength } from './utils.js';

// Input de senha com toggle olhinho mostrar/ocultar.
// API idêntica a <input type="password"> — drop-in replacement.
// Prop opcional `strengthMeter`: quando true, mostra barra de força + lista
// de requisitos faltantes em tempo real (usado em telas de criação/troca).
export const PasswordInput = forwardRef(function PasswordInput(
  { className = '', containerClassName = '', strengthMeter = false, value, ...props },
  ref
) {
  const [show, setShow] = useState(false);
  const pwd = value || '';
  const meter = strengthMeter && pwd ? validatePasswordStrength(pwd) : null;

  // Cor + largura da barra conforme o score (0-5)
  const barColor = meter
    ? meter.score <= 2 ? 'bg-red-500'
      : meter.score <= 4 ? 'bg-yellow-500'
      : 'bg-green-500'
    : 'bg-gray-600';
  const barWidth = meter ? `${(meter.score / 5) * 100}%` : '0%';

  return (
    <div className={containerClassName}>
      <div className="relative">
        <input
          ref={ref}
          type={show ? 'text' : 'password'}
          className={`${className} pr-11`}
          value={value}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
          tabIndex={-1}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 p-2 rounded-md transition focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {show ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
              <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>

      {/* Barra de força + requisitos pendentes (só quando strengthMeter=true) */}
      {meter && (
        <div className="mt-2">
          <div className="h-1.5 w-full bg-gray-700 rounded-full overflow-hidden">
            <div className={`h-full ${barColor} transition-all duration-300`} style={{ width: barWidth }} />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className={`text-[11px] font-medium ${
              meter.strength === 'forte' ? 'text-green-400'
                : meter.strength === 'média' ? 'text-yellow-400'
                : 'text-red-400'
            }`}>
              Força: {meter.strength}
            </span>
            {!meter.ok && (
              <span className="text-[11px] text-gray-400">
                Falta: {meter.reasons[0]}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
