export default function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-leaf-200 rounded-2xl p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="font-bold text-leaf-900 text-base">{title}</h2>
        {description && <p className="text-xs text-leaf-500 mt-1">{description}</p>}
      </div>
      {children}
    </div>
  );
}
