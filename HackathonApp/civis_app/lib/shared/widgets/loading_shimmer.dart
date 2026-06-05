import 'package:flutter/material.dart';

class LoadingShimmer extends StatefulWidget {
  final double height;
  final double? width;
  final double radius;
  const LoadingShimmer({super.key, this.height = 16, this.width, this.radius = 4});

  @override
  State<LoadingShimmer> createState() => _LoadingShimmerState();
}

class _LoadingShimmerState extends State<LoadingShimmer>
    with SingleTickerProviderStateMixin {
  late AnimationController _ctrl;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200))
      ..repeat();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _ctrl,
      builder: (context, child) => Container(
        height: widget.height,
        width: widget.width ?? double.infinity,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(widget.radius),
          gradient: LinearGradient(
            begin: Alignment(-1 + 2 * _ctrl.value - 0.5, 0),
            end: Alignment(-1 + 2 * _ctrl.value + 0.5, 0),
            colors: const [
              Color(0xFF1A1A2E),
              Color(0xFF2A2A4E),
              Color(0xFF1A1A2E),
            ],
          ),
        ),
      ),
    );
  }
}
