import re

with open('frontend/src/app/notebooks/[id]/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

chat_start = content.find('{/* ── Center: Chat Dialogue')
viewer_start = content.find('{/* ── Right Panel: Document Viewer')
# Find the end of the viewer block by looking for the end of the component
viewer_end = content.rfind('</div>')

if chat_start != -1 and viewer_start != -1:
    chat_block = content[chat_start:viewer_start]
    # The viewer block is from viewer_start to the last closing div of the flex container
    # Let's just find the closing tag of the Viewer block's outer `<aside>`
    aside_end = content.find('</aside>', viewer_start) + len('</aside>')
    # Wait, there might be nested asides? No. Let's just find the closing tag matching the indentation
    # Let's search backwards from the end
    last_aside_end = content.rfind('</aside>', viewer_start) + len('</aside>')
    if last_aside_end < viewer_start:
         last_aside_end = content.find('</aside>', viewer_start) + len('</aside>')
         
    # Actually, we can just split the content by the two markers
    # the viewer block goes all the way to the end, minus the closing divs
    # Let's just use `viewer_block = content[viewer_start:last_aside_end]` but there's a conditional `{viewerDoc && (`
    # The end of the viewer block is `  )}`
    viewer_end_str = '\n        )}'
    viewer_end = content.find(viewer_end_str, viewer_start) + len(viewer_end_str)
    
    chat_block = content[chat_start:viewer_start]
    viewer_block = content[viewer_start:viewer_end]
    
    chat_block_modified = chat_block.replace(
        '<main className="flex-1 flex flex-col overflow-hidden bg-white z-0">',
        '<aside className="flex flex-col overflow-hidden bg-white z-0 border-l border-gray-200" style={{ width: viewerDoc ? `${chatWidth}px` : \'100%\', flex: viewerDoc ? \'none\' : \'1\' }}>'
    ).replace('</main>', '</aside>')
    
    viewer_block_modified = viewer_block.replace(
        '<aside className="w-96 bg-white border-l border-gray-200 flex flex-col flex-shrink-0 z-30 shadow-2xl animate-slide-left relative select-text h-full">',
        '<main className="flex-1 bg-white border-l border-gray-200 flex flex-col relative select-text h-full z-10 overflow-hidden">'
    ).replace('</aside>', '</main>')
    
    resizer = """
        {/* Draggable Divider */}
        {viewerDoc && (
          <div 
            className="w-1.5 bg-gray-200 hover:bg-indigo-400 cursor-col-resize z-20 flex-shrink-0 transition-colors"
            onMouseDown={(e) => {
              const startX = e.clientX;
              const startWidth = chatWidth;
              const onMouseMove = (moveEvent) => {
                const deltaX = startX - moveEvent.clientX; 
                setChatWidth(Math.max(300, Math.min(startWidth + deltaX, window.innerWidth - 400)));
              };
              const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
              };
              document.addEventListener('mousemove', onMouseMove);
              document.addEventListener('mouseup', onMouseUp);
            }}
          />
        )}
"""
    
    new_content = content[:chat_start] + viewer_block_modified + resizer + chat_block_modified + content[viewer_end:]
    
    new_content = new_content.replace(
        'const [transcriptUploading, setTranscriptUploading] = useState(false);',
        'const [transcriptUploading, setTranscriptUploading] = useState(false);\n  const [chatWidth, setChatWidth] = useState(450);'
    )
    
    with open('frontend/src/app/notebooks/[id]/page.tsx', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print('Swapped and modified blocks successfully.')
else:
    print('Could not find blocks.')
