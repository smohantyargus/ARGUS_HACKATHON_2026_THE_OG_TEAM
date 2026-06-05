import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

const kEpiColor = Color(0xFFE53935);
const kEconColor = Color(0xFFFFA000);
const kBehaviorColor = Color(0xFF00897B);
const kLogisticsColor = Color(0xFF3949AB);
const kHealthcareColor = Color(0xFF43A047);
const kSurfaceColor = Color(0xFF1A1A2E);
const kCardColor = Color(0xFF16213E);
const kAccentColor = Color(0xFF0F3460);

ThemeData buildTheme() {
  final base = ThemeData.dark();
  return base.copyWith(
    scaffoldBackgroundColor: kSurfaceColor,
    cardColor: kCardColor,
    colorScheme: const ColorScheme.dark(
      primary: Color(0xFF4FC3F7),
      secondary: Color(0xFF4FC3F7),
      surface: kCardColor,
      error: Color(0xFFCF6679),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: kAccentColor,
      elevation: 0,
      titleTextStyle: GoogleFonts.rajdhani(
        fontSize: 20,
        fontWeight: FontWeight.w700,
        letterSpacing: 1.5,
        color: Colors.white,
      ),
    ),
    textTheme: GoogleFonts.interTextTheme(base.textTheme).apply(
      bodyColor: Colors.white,
      displayColor: Colors.white,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: kAccentColor,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide.none,
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: Color(0xFF4FC3F7), width: 1.5),
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: const Color(0xFF4FC3F7),
        foregroundColor: Colors.black87,
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 24),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
      ),
    ),
  );
}
