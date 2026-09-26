'use client';

import { Swords } from 'lucide-react';
import BoardGameSettings from '@/components/BoardGameSettings';

export default function ShogiSettingsPage() {
  return <BoardGameSettings game="shogi" name="将棋" icon={Swords} />;
}
