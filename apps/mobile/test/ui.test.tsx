import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, cleanPrice, ErrorState, Field, PriceField } from '@/ui';
import { ApiError } from '@/lib/api';
import { ThemeProvider } from '@/theme';

jest.mock('@/lib/config', () => ({ API: { origin: 'https://api.test', problem: null } }));

const wrap = (node: React.ReactElement) => render(<ThemeProvider>{node}</ThemeProvider>);

describe('price input', () => {
  it('turns a decimal comma into a point and removes anything else', () => {
    expect(cleanPrice('3300,50')).toBe('3300.50');
    expect(cleanPrice(' 3 300.5a')).toBe('3300.5');
  });

  it('uses a numeric keyboard', async () => {
    const seen: string[] = [];
    await wrap(<PriceField testID="price" label="Entry" value="" onChange={(v) => seen.push(v)} />);
    const input = screen.getByTestId('price');
    expect(input.props.keyboardType).toBe('decimal-pad');
    await fireEvent.changeText(input, '12,5');
    expect(seen).toEqual(['12.5']);
  });
});

describe('fields', () => {
  it('shows an error in place of the hint', async () => {
    await wrap(<Field label="Name" hint="A hint" error="Enter a name" />);
    expect(screen.getByText('Enter a name')).toBeTruthy();
    expect(screen.queryByText('A hint')).toBeNull();
  });

  it('hides a password until asked', async () => {
    await wrap(<Field testID="pw" label="Password" secret />);
    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByLabelText('Show password'));
    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(false);
  });
});

describe('buttons', () => {
  it('cannot be pressed while busy or disabled', async () => {
    const press = jest.fn();
    await wrap(
      <>
        <Button label="One" loading onPress={press} />
        <Button label="Two" disabled onPress={press} />
        <Button label="Three" onPress={press} />
      </>,
    );
    await fireEvent.press(screen.getByLabelText('One'));
    await fireEvent.press(screen.getByLabelText('Two'));
    expect(press).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Three'));
    expect(press).toHaveBeenCalledTimes(1);
  });
});

describe('errors', () => {
  it('says plainly when the phone is offline, and offers to retry', async () => {
    const retry = jest.fn();
    await wrap(<ErrorState error={new ApiError(0, 'NETWORK', 'Could not reach the server.')} onRetry={retry} />);
    expect(screen.getByText('You appear to be offline')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Try again'));
    expect(retry).toHaveBeenCalled();
  });
});
