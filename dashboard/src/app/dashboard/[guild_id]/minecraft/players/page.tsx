import MinecraftSettings from '@/components/minecraft/MinecraftSettings';

export default function Page({ params }: { params: { guild_id: string } }) {
  return <MinecraftSettings guildId={params.guild_id} view="players" />;
}
