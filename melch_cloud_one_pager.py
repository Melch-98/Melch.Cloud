#!/usr/bin/env python3
"""
melch.cloud 1-pager PDF
– Gold / dark brand palette
– Embedded app screenshots (cropped)
– Statlas-inspired clean layout
"""

import os
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, Color
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle

# ── Brand palette ──
BG          = HexColor('#0A0A0A')
BG_CARD     = HexColor('#111111')
CARD_BORDER = HexColor('#1C1C1C')
GOLD        = HexColor('#C8B89A')
GOLD_DIM    = HexColor('#A89A7A')
GOLD_LIGHT  = HexColor('#E0D5C0')
WHITE       = HexColor('#F5F5F8')
GRAY        = HexColor('#888888')
GRAY_DIM    = HexColor('#555555')
META_BLUE   = HexColor('#5B9CF5')
GOOG_GREEN  = HexColor('#34A853')
SHOP_GREEN  = HexColor('#96BF48')
PURPLE      = HexColor('#A855F7')
EMERALD     = HexColor('#10B981')

W, H = letter
M = 44  # margin

BASE = os.path.dirname(os.path.abspath(__file__))
IMG1 = os.path.join(BASE, 'screenshot-campaigns.jpg')
IMG2 = os.path.join(BASE, 'screenshot-pnl.jpg')

# ── Helpers ──

def rrect(c, x, y, w, h, r, fill, stroke=None):
    c.saveState()
    c.setFillColor(fill)
    c.setStrokeColor(stroke or fill)
    if stroke: c.setLineWidth(0.6)
    p = c.beginPath()
    p.moveTo(x+r,y); p.lineTo(x+w-r,y)
    p.arcTo(x+w-r,y,x+w,y+r,0,90); p.lineTo(x+w,y+h-r)
    p.arcTo(x+w-r,y+h-r,x+w,y+h,0,90); p.lineTo(x+r,y+h)
    p.arcTo(x,y+h-r,x+r,y+h,0,90); p.lineTo(x,y+r)
    p.arcTo(x,y,x+r,y+r,0,90); p.close()
    c.drawPath(p, fill=1, stroke=1 if stroke else 0)
    c.restoreState()

def gold_bar(c, x, y, w, h, steps=50):
    sw = w/steps
    for i in range(steps):
        t = i/(steps-1)
        b = 0.5 + 0.5*(1-abs(2*t-1))
        c.setFillColor(Color(
            GOLD_DIM.red+(GOLD_LIGHT.red-GOLD_DIM.red)*b,
            GOLD_DIM.green+(GOLD_LIGHT.green-GOLD_DIM.green)*b,
            GOLD_DIM.blue+(GOLD_LIGHT.blue-GOLD_DIM.blue)*b))
        c.rect(x+i*sw, y, sw+0.5, h, fill=1, stroke=0)

def pill(c, x, y, text, clr):
    tw = c.stringWidth(text,'Helvetica-Bold',6.5)+14
    c.saveState()
    c.setFillColor(Color(min(1,clr.red*0.15+0.04), min(1,clr.green*0.15+0.04), min(1,clr.blue*0.15+0.04)))
    c.roundRect(x,y-4,tw,14,4,fill=1,stroke=0)
    c.setFillColor(clr); c.setFont('Helvetica-Bold',6.5)
    c.drawString(x+7,y,text); c.restoreState()
    return tw+5


def build(fn):
    c = canvas.Canvas(fn, pagesize=letter)

    # BG
    c.setFillColor(BG); c.rect(0,0,W,H,fill=1,stroke=0)

    # Top gold bar
    gold_bar(c, 0, H-3, W, 3)

    # ── Header ──
    y = H - 36
    c.setFillColor(WHITE); c.setFont('Helvetica-Bold',24)
    c.drawString(M, y, 'melch')
    tw = c.stringWidth('melch','Helvetica-Bold',24)
    c.setFillColor(GOLD); c.drawString(M+tw, y, '.cloud')
    c.setFont('Helvetica',6.5); c.setFillColor(GRAY_DIM)
    c.drawString(M, y-11, 'C O M M A N D   C E N T E R')

    c.setFont('Helvetica',8); c.setFillColor(GOLD_LIGHT)
    c.drawRightString(W-M, y+2, 'melch.cloud')
    c.setFont('Helvetica',7); c.setFillColor(GRAY)
    c.drawRightString(W-M, y-10, 'info@melch.media')

    # Divider
    y -= 20
    c.setStrokeColor(HexColor('#1A1A1A')); c.setLineWidth(0.4)
    c.line(M, y, W-M, y)

    # ── Tagline ──
    y -= 20
    c.setFont('Helvetica-Bold',17); c.setFillColor(WHITE)
    c.drawString(M, y, "Your Brand's Performance.")
    y -= 20
    c.setFillColor(GOLD)
    c.drawString(M, y, 'One Dashboard. Zero Guesswork.')

    # ── Intro ──
    y -= 18
    sty = ParagraphStyle('i', fontName='Helvetica', fontSize=8, leading=12.5, textColor=GRAY)
    txt = (
        "melch.cloud is a unified performance command center built for DTC brands and media buying teams. "
        "It connects your Shopify revenue, Meta ad spend, and Google Ads data into a single real-time "
        "dashboard — giving you P&amp;L visibility, campaign metrics, creative analytics, and copy "
        "analysis without switching between five different platforms."
    )
    p = Paragraph(txt, sty)
    pw, ph = p.wrap(W-M*2, 200)
    p.drawOn(c, M, y-ph)
    y -= ph + 14

    # ── Screenshots ──
    c.setFont('Helvetica-Bold',7); c.setFillColor(GOLD)
    c.drawString(M, y, 'INSIDE THE PLATFORM')
    ltw = c.stringWidth('INSIDE THE PLATFORM','Helvetica-Bold',7)
    c.setStrokeColor(GOLD_DIM); c.setLineWidth(0.4)
    c.line(M+ltw+6, y+3, M+ltw+50, y+3)
    y -= 8

    # Two screenshots side by side — each fills half width
    gap = 10
    iw = (W - M*2 - gap) / 2  # ~257 each
    ih = iw * 700 / 1080       # maintain aspect ratio ~166

    label_h = 14

    for idx, (img, label) in enumerate([(IMG1, 'CAMPAIGN PERFORMANCE'), (IMG2, 'DAILY P&L')]):
        ix = M + idx * (iw + gap)
        iy = y - ih - label_h

        # Card frame
        rrect(c, ix-3, iy-3, iw+6, ih+label_h+6, 6, BG_CARD, CARD_BORDER)

        # Label
        c.setFont('Helvetica-Bold',6); c.setFillColor(GOLD_DIM)
        c.drawString(ix+4, y - 10, label)

        # Image
        if os.path.exists(img):
            c.drawImage(img, ix, iy, width=iw, height=ih, preserveAspectRatio=False)

    y -= ih + label_h + 14

    # ── What It Does — compact 2x2 ──
    c.setFont('Helvetica-Bold',7); c.setFillColor(GOLD)
    c.drawString(M, y, 'WHAT IT DOES')
    ltw2 = c.stringWidth('WHAT IT DOES','Helvetica-Bold',7)
    c.setStrokeColor(GOLD_DIM); c.setLineWidth(0.4)
    c.line(M+ltw2+6, y+3, M+ltw2+50, y+3)
    y -= 14

    features = [
        ('$', 'Daily P&L', EMERALD,
         'Real-time P&L with Shopify revenue, COGS, margin, MER, CAC, AOV — updated daily.'),
        ('▲', 'Campaigns', META_BLUE,
         'Cross-platform Meta + Google metrics in one view. Spend, ROAS, CPA, CTR.'),
        ('◆', 'Creative Intel', PURPLE,
         'Creative scoring, copy patterns, hook ID across your entire ad library.'),
        ('●', 'Team Mgmt', GOLD,
         'Multi-brand, role-based access. Admin, strategist, founder views.'),
    ]

    cw = (W - M*2 - 10) / 2
    ch = 56

    for i, (sym, title, clr, desc) in enumerate(features):
        col, row = i%2, i//2
        cx = M + col*(cw+10)
        cy = y - row*(ch+8)

        rrect(c, cx, cy-ch+4, cw, ch, 5, BG_CARD, CARD_BORDER)

        # Icon dot
        c.saveState()
        c.setFillColor(Color(clr.red*0.25, clr.green*0.25, clr.blue*0.25))
        c.circle(cx+14, cy-10, 6, fill=1, stroke=0)
        c.setFillColor(clr); c.setFont('Helvetica-Bold',8)
        c.drawCentredString(cx+14, cy-13, sym)
        c.restoreState()

        c.setFont('Helvetica-Bold',9); c.setFillColor(WHITE)
        c.drawString(cx+24, cy-13, title)

        ds = ParagraphStyle(f'f{i}', fontName='Helvetica', fontSize=6.8, leading=9.5, textColor=GRAY)
        dp = Paragraph(desc, ds)
        dp.wrap(cw-20, 36)
        dp.drawOn(c, cx+10, cy-ch+8)

    y -= 2*(ch+8) + 2

    # ── How It Works ──
    c.setFont('Helvetica-Bold',7); c.setFillColor(GOLD)
    c.drawString(M, y, 'HOW IT WORKS')
    ltw3 = c.stringWidth('HOW IT WORKS','Helvetica-Bold',7)
    c.setStrokeColor(GOLD_DIM); c.setLineWidth(0.4)
    c.line(M+ltw3+6, y+3, M+ltw3+50, y+3)
    y -= 16

    steps = [
        ('01','Connect','Add Shopify, Meta Ad Account, Google Ads ID on the Team page.'),
        ('02','Sync','Data flows automatically — orders, spend, metrics update daily.'),
        ('03','Analyze','Open the Command Center. P&L, campaigns, creatives — unified.'),
    ]
    sw_ = (W-M*2-16)/3
    for i,(num,title,desc) in enumerate(steps):
        sx = M + i*(sw_+8)
        c.setFont('Helvetica-Bold',11); c.setFillColor(GOLD_DIM)
        c.drawString(sx, y, num)
        c.setFont('Helvetica-Bold',8.5); c.setFillColor(WHITE)
        c.drawString(sx+22, y, title)
        ss = ParagraphStyle(f's{i}', fontName='Helvetica', fontSize=6.5, leading=9, textColor=GRAY)
        sp = Paragraph(desc, ss)
        sp.wrap(sw_-4, 28)
        sp.drawOn(c, sx, y-12-20)

    y -= 44

    # ── Integrations ──
    c.setStrokeColor(HexColor('#1A1A1A')); c.setLineWidth(0.4)
    c.line(M, y, W-M, y)
    y -= 14
    c.setFont('Helvetica-Bold',6.5); c.setFillColor(GRAY_DIM)
    c.drawString(M, y, 'INTEGRATIONS')
    ix = M+74
    ix += pill(c, ix, y, 'SHOPIFY', SHOP_GREEN)
    ix += pill(c, ix, y, 'META ADS', META_BLUE)
    ix += pill(c, ix, y, 'GOOGLE ADS', GOOG_GREEN)
    ix += pill(c, ix, y, 'WINDSOR.AI', PURPLE)
    y -= 18

    # ── Value strip ──
    rrect(c, M, y-34, W-M*2, 36, 5, BG_CARD, CARD_BORDER)
    vals = [('Real-Time P&L','Daily Shopify + ad sync'),('Multi-Brand','All brands, one login'),
            ('Role-Based Access','Admin · Strategist · Founder'),('Zero Duct Tape','Connect once, data flows')]
    vw = (W-M*2)/4
    for i,(lab,sub) in enumerate(vals):
        vx = M + i*vw + vw/2
        c.setFont('Helvetica-Bold',7.5); c.setFillColor(WHITE)
        c.drawCentredString(vx, y-13, lab)
        c.setFont('Helvetica',6); c.setFillColor(GRAY_DIM)
        c.drawCentredString(vx, y-23, sub)
    y -= 46

    # ── CTA ──
    rrect(c, M, y-34, W-M*2, 36, 5, HexColor('#0F0F0F'), GOLD_DIM)
    c.setFont('Helvetica-Bold',11); c.setFillColor(WHITE)
    c.drawCentredString(W/2, y-13, "Ready to see your brand's real numbers?")
    c.setFont('Helvetica',8); c.setFillColor(GOLD)
    c.drawCentredString(W/2, y-26, 'melch.cloud  ·  info@melch.media')

    # Footer
    c.setFont('Helvetica',6); c.setFillColor(HexColor('#333333'))
    c.drawCentredString(W/2, 14, '© 2026 melch.cloud  ·  Built by Melch Media')
    gold_bar(c, 0, 0, W, 2)

    c.save()
    print(f'PDF saved to {fn}')


if __name__ == '__main__':
    build('/sessions/quirky-relaxed-archimedes/mnt/Melch.Cloud/melch-cloud-one-pager.pdf')
