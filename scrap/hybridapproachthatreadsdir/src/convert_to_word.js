const { Document, Packer, Paragraph, HeadingLevel, TextRun, ImageRun } = require('docx');
const fs = require('fs');
const path = require('path');
const sizeOf = require('image-size');

const MAX_WIDTH = 600; // Maximum width in pixels
const MAX_HEIGHT = 800; // Maximum height in pixels

async function convertEditorJSToWord(editorjsData, outputPath, projectId) {
  console.log("Starting conversion of EditorJS data to Word document");

  const children = await Promise.all(
    editorjsData.blocks.map(async (block) => {
      if (block.type === 'header') {
        return new Paragraph({
          text: block.data.text,
          heading: HeadingLevel[`HEADING_${block.data.level}`],
        });
      } else if (block.type === 'paragraph') {
        return new Paragraph(block.data.text);
      } else if (block.type === 'song') {
        const songUrl = block.data.songUrl;
        const songName = path.basename(songUrl);
        const startTime = block.data.startTime;
        const endTime = block.data.endTime;
        return new Paragraph({
          spacing: {
            after: 200,
          },
          children: [
            new TextRun({
              text: songName,
              italics: true,
            }),
            new TextRun({
              text: ` [${startTime}s - ${endTime}s]`,
            }),
          ],
        });
      } else if (block.type === 'image') {
        const imageUrl = block.data.url;
        const imageFilename = path.basename(imageUrl);
        const imagePath = path.join('projects', projectId, 'images', imageFilename);
        console.log(`Handling image block: URL=${imageUrl}, Filename=${imageFilename}, Path=${imagePath}`);
        if (fs.existsSync(imagePath)) {
          try {
            const buffer = fs.readFileSync(imagePath);
            const dimensions = sizeOf(imagePath); // Get the original dimensions of the image

            // Resize the image if it's too large
            let width = dimensions.width;
            let height = dimensions.height;
            if (width > MAX_WIDTH || height > MAX_HEIGHT) {
              const aspectRatio = width / height;
              if (width > height) {
                width = MAX_WIDTH;
                height = Math.round(MAX_WIDTH / aspectRatio);
              } else {
                height = MAX_HEIGHT;
                width = Math.round(MAX_HEIGHT * aspectRatio);
              }
            }

            return new Paragraph({
              spacing: {
                after: 200,
              },
              children: [
                new ImageRun({
                  data: buffer,
                  transformation: {
                    width,
                    height,
                  },
                }),
              ],
            });
          } catch (error) {
            console.error(`Failed to load image: ${imageUrl}. Error: ${error}`);
            return new Paragraph({
              text: `Failed to load image: ${imageUrl}`,
              style: "Normal",
            });
          }
        } else {
          console.warn(`Image not found: ${imageUrl}`);
          return new Paragraph({
            text: `Image not found: ${imageUrl}`,
            style: "Normal",
            spacing: {
              after: 200,
            },
          });
        }
      } else {
        return new Paragraph({
          text: `Unsupported block type: ${block.type}`,
          spacing: {
            after: 200,
          },
        });
      }
    })
  );

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);

  console.log(`Successfully saved Word document to ${outputPath}`);
}

module.exports = { convertEditorJSToWord };
