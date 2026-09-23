import React, { useRef, useEffect } from 'react';

interface SafeTextInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string;
  onChange: (val: string) => void;
}

/**
 * SafeTextInput handles complex IME compositions (such as Bengali / Bangla,
 * Arabic, Hindi) seamlessly on mobile keyboards (Gboard, Ridmik) and WebViews.
 * 
 * It prevents React's controlled input reconciliation from overwriting the DOM
 * value during active composition, which is what causes uncommitted Bengali
 * characters to be invisible until a space or commit is pressed.
 * 
 * Supports all characters without restriction: letters, numbers, symbols,
 * spaces, all Unicode scripts, and emojis.
 */
export const SafeTextInput: React.FC<SafeTextInputProps> = ({
  value,
  onChange,
  className = '',
  type = 'text',
  style,
  ...props
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);

  // Synchronize internal DOM value when prop changes from outside (e.g. form reset),
  // but NEVER overwrite while the user is actively focused and typing.
  useEffect(() => {
    if (inputRef.current) {
      const isFocused = document.activeElement === inputRef.current;
      if (!isFocused || value === '') {
        if (inputRef.current.value !== value) {
          inputRef.current.value = value;
        }
      }
    }
  }, [value]);

  const handleCompositionStart = (e: React.CompositionEvent<HTMLInputElement>) => {
    isComposingRef.current = true;
    props.onCompositionStart?.(e);
  };

  const handleCompositionUpdate = (e: React.CompositionEvent<HTMLInputElement>) => {
    onChange(e.currentTarget.value);
    props.onCompositionUpdate?.(e);
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    isComposingRef.current = false;
    onChange(e.currentTarget.value);
    props.onCompositionEnd?.(e);
  };

  const handleInput = (e: React.FormEvent<HTMLInputElement>) => {
    onChange(e.currentTarget.value);
  };

  return (
    <input
      ref={inputRef}
      type={type}
      defaultValue={value}
      onCompositionStart={handleCompositionStart}
      onCompositionUpdate={handleCompositionUpdate}
      onCompositionEnd={handleCompositionEnd}
      onInput={handleInput}
      dir="auto"
      className={className}
      style={{
        colorScheme: 'light',
        color: '#0F172A',
        WebkitTextFillColor: '#0F172A',
        caretColor: '#15803D',
        ...style,
      }}
      {...props}
    />
  );
};
