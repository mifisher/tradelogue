interface CardProps {
  title?: string;
  className?: string;
  children: React.ReactNode;
}

export function Card({ title, className, children }: CardProps) {
  return (
    <section className={`bg-elevated rounded-[20px] p-8${className ? ` ${className}` : ''}`}>
      {title && (
        <h2 className="font-display text-xl text-ondark mb-6">{title}</h2>
      )}
      {children}
    </section>
  );
}
