'use client';

import { Crown } from 'lucide-react';
import BoardGameSettings from '@/components/BoardGameSettings';

export default function ChessSettingsPage() {
  return <BoardGameSettings game="chess" name="チェス" icon={Crown} />;
}
