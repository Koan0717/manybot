'use client';

import { Disc3 } from 'lucide-react';
import BoardGameSettings from '@/components/BoardGameSettings';

export default function OthelloSettingsPage() {
  return <BoardGameSettings game="othello" name="オセロ" icon={Disc3} />;
}
