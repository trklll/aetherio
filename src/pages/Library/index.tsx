import PageContainer from "../../components/layout/PageContainer";

export default function LibraryPage() {
  return (
    <PageContainer className="flex flex-col h-full py-8 animate-fadeIn">
      <h1 className="text-3xl font-bold text-text-primary mb-8">Biblioteca</h1>
      <div className="grid grid-cols-2 gap-4 max-w-md">
        {["Favoritos", "Lista de seguimiento"].map(s => (
          <div key={s} className="glass rounded-glass p-6 text-center text-text-secondary hover:text-text-primary transition-colors cursor-pointer">
            {s}
          </div>
        ))}
      </div>
    </PageContainer>
  );
}
