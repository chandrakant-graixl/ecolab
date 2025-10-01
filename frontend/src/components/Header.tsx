export default function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-gray-300 bg-white/80 backdrop-blur">
      <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded bg-blue-600" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">Air Quality Agent</h1>
            <p className="text-xs text-gray-500">OpenAQ + RAG (Chroma)</p>
          </div>
        </div>
      </div>
    </header>
  );
}
