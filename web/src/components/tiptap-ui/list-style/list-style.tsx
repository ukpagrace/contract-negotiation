// // list-style-picker.tsx
// import React, { useState } from "react"
// import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
// import { Button, type ButtonProps } from "@/components/tiptap-ui-primitive/button"

// import { ListOrdered } from "lucide-react"
// import { LIST_STYLES, type ListStylePreset } from "./list-style"

// interface ListStylePickerProps {
//   currentStyle: ListStylePreset
//   onSelectStyle: (style: ListStylePreset) => void
// }

// export function ListStylePicker({
//   currentStyle,
//   onSelectStyle,
// }: ListStylePickerProps) {
//   return (
//     <Popover>
//       <PopoverTrigger asChild>
//         <Button variant="ghost" size="sm" tooltip="List Style Options">
//           <ListOrdered className="h-4 w-4" />
//         </Button>
//       </PopoverTrigger>
      
//       <PopoverContent className="w-[320px] p-3 bg='#18181b' border-zinc-800 rounded-2xl shadow-2xl">
//         <div className="grid grid-cols-3 gap-2">
//           {LIST_STYLES.map((style : any) => {
//             const isSelected = currentStyle === style.id
//             return (
//               <button
//                 key={style.id}
//                 type="button"
//                 onClick={() => onSelectStyle(style.id)}
//                 className={`flex flex-col justify-between p-3 h-28 rounded-xl border text-left transition-all ${
//                   isSelected
//                     ? "bg-zinc-800 border-zinc-600 ring-1 ring-zinc-500"
//                     : "bg-zinc-900/50 border-zinc-800/80 hover:bg-zinc-800/50 hover:border-zinc-700"
//                 }`}
//               >
//                 {/* Visual Representation Lines */}
//                 <div className="space-y-1 font-mono text-xs text-zinc-300">
//                   <div className="flex items-center gap-1.5">
//                     <span className="w-4 text-right">{style.preview[0]}</span>
//                     <div className="h-[2px] w-8 bg-zinc-600 rounded" />
//                   </div>
//                   <div className="flex items-center gap-1.5 pl-3">
//                     <span className="w-4 text-right">{style.preview[1]}</span>
//                     <div className="h-[2px] w-6 bg-zinc-600 rounded" />
//                   </div>
//                   <div className="flex items-center gap-1.5 pl-3">
//                     <span className="w-4 text-right">{style.preview[2]}</span>
//                     <div className="h-[2px] w-6 bg-zinc-600 rounded" />
//                   </div>
//                   <div className="flex items-center gap-1.5 pl-6">
//                     <span className="w-4 text-right">{style.preview[3]}</span>
//                     <div className="h-[2px] w-4 bg-zinc-600 rounded" />
//                   </div>
//                   <div className="flex items-center gap-1.5">
//                     <span className="w-4 text-right">{style.preview[4]}</span>
//                     <div className="h-[2px] w-8 bg-zinc-600 rounded" />
//                   </div>
//                 </div>
//               </button>
//             )
//           })}
//         </div>
//       </PopoverContent>
//     </Popover>
//   )
// }