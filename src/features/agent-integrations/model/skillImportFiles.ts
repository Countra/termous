export function groupSkillFiles(files: readonly File[]): Map<string, File[]> {
  const groups=new Map<string,File[]>()
  const paths=files.map(file=>({file,path:file.webkitRelativePath || file.name}))
  const roots=paths.filter(item=>item.path==='SKILL.md' || item.path.endsWith('/SKILL.md'))
    .map(item=>item.path.slice(0,-'SKILL.md'.length)).sort((a,b)=>b.length-a.length || a.localeCompare(b))
  for (const root of roots) groups.set(root || '.',[])
  for (const item of paths) {
    if (!item.file.webkitRelativePath && item.path.toLowerCase().endsWith('.zip')) { groups.set(item.path,[item.file]);continue }
    const root=roots.find(root=>item.path.startsWith(root))
    if (root!==undefined) groups.get(root || '.')!.push(item.file)
  }
  return groups
}
