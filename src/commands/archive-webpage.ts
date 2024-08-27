import { ArchiveOptions } from "../../main.ts"
import { capturePDF, launchChromiumWithExtensions } from "../browser.ts"
import { checkStatus, LinkStatus } from "../linkChecker.ts"
import { spreadsheet } from "../spreadsheet.ts"
import { savePDFLocally, uploadToGCS } from "../storage.ts"

export async function archiveWebpage(args: ArchiveOptions) {
	await spreadsheet.loadInfo()
	const sheet = spreadsheet.sheetsByTitle["Other"]

	const rows = await sheet.getRows()
	const browser = await launchChromiumWithExtensions([])
	const alreadySeenDomains = new Set<string>()

	for (const row of rows) {
		const pageURL = row.get("URL")
		if (!pageURL) {
			continue
		}

		let url: URL
		try {
			url = new URL(pageURL)
		} catch (err: unknown) {
			console.error(`Error parsing URL ${pageURL}:`, err)
			continue
		}

		const domain = url.hostname
		if (args.domain && !domain.includes(args.domain)) {
			continue
		}

		if (args.processOnce) {
			if (alreadySeenDomains.has(domain)) {
				continue
			} else {
				alreadySeenDomains.add(domain)
			}
		}

		console.log(`${row.rowNumber} - checking status of ${domain}`)

		const status = await checkStatus(pageURL)
		if (status === LinkStatus.DEAD) {
			console.log(
				`${row.rowNumber} - ${pageURL} is dead. Looking up in the Internet Archive.`,
			)

			if (args.useArchive) {
				// Lookup in Internet Archive
				continue
			}
		}

		console.log(`${row.rowNumber} - capturing ${domain} as pdf`)

		try {
			const pdfBytes = await capturePDF(browser, pageURL)
			if (args.storeInGCS) {
				await uploadToGCS(pdfBytes, url.href)
			} else {
				savePDFLocally(pdfBytes, url.href)
			}
		} catch (err: unknown) {
			console.error(`Error uploading PDF for ${domain}:`, err)
		}
	}

	await browser.close()
}
