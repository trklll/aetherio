"use client"

import { use } from "react"
import { PosterEditorContainer } from "@/components/PosterEditorContainer"

export default function MoviePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const id = parseInt(resolvedParams.id, 10)

  if (isNaN(id) || id <= 0) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
        <p className="text-sm text-zinc-400">Invalid Movie ID</p>
      </div>
    )
  }

  return <PosterEditorContainer id={id} mediaType="movie" />
}
